import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateContract, readJson } from "../../../packages/contracts/src/validate-contract.mjs";
import { verifyEvidenceManifest } from "../../evidence-service/src/manifest.mjs";
import { buildRetentionSummary, expireEvidenceManifests } from "../../evidence-service/src/retention.mjs";
import { appendAudit, ensureStore, readDb, updateDb } from "./store.mjs";
import { badRequest, forbidden, notFound, payloadTooLarge, readJsonBody, sendJson, unauthorized, withSecurityHeaders } from "./http.mjs";
import { notifyIncidentEvent } from "./notifier.mjs";
import { authenticateOperator, clientRateLimitKey, createRateLimiter, hashDeviceKey, issueDeviceKey, publicCamera, publicCameraWithIssuedKey, verifyDeviceKey } from "./security.mjs";
import { buildSlaSummary } from "./sla.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const PORT = Number(process.env.PORT || 7080);
const uiDir = path.join(root, "apps/command-ui/public");
const rateLimiter = createRateLimiter({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  maxRequests: Number(process.env.RATE_LIMIT_MAX || 240)
});
const eventClients = new Set();

const schemas = {
  incident: readJson(path.join(root, "packages/contracts/schemas/incident-event.schema.json")),
  cameraHealth: readJson(path.join(root, "packages/contracts/schemas/camera-health.schema.json")),
  evidence: readJson(path.join(root, "packages/contracts/schemas/evidence-manifest.schema.json"))
};

ensureStore();

const server = http.createServer(async (req, res) => {
  try {
    const rate = rateLimiter.check(clientRateLimitKey(req));
    if (!rate.allowed) {
      return sendJson(res, 429, { error: "rate_limited", retryAfterMs: Math.max(0, rate.resetAt - Date.now()) });
    }

    if (req.method === "OPTIONS") return sendJson(res, 204, {});

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/") || ["/main.js", "/styles.css"].includes(url.pathname))) {
      return serveStaticUi(res, url.pathname);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", service: "control-api", time: new Date().toISOString() });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const auth = authenticateOperator(req, { requiredPermission: "incident:read" });
      if (!auth.ok) return auth.statusCode === 403 ? forbidden(res, auth.message) : unauthorized(res, auth.message);
      return openEventStream(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/cameras/register") {
      return registerCamera(req, res, await readJsonBody(req));
    }

    if (req.method === "POST" && url.pathname === "/api/cameras/health") {
      return updateCameraHealth(req, res, await readJsonBody(req));
    }

    if (req.method === "POST" && url.pathname === "/api/cameras/rotate-key") {
      return rotateCameraKey(req, res, await readJsonBody(req));
    }

    if (req.method === "GET" && url.pathname === "/api/cameras") {
      return sendJson(res, 200, readDb().cameras.map(publicCamera));
    }

    if (req.method === "GET" && url.pathname === "/api/zones") {
      return sendJson(res, 200, readDb().zones);
    }

    if (req.method === "POST" && url.pathname === "/api/incidents") {
      return createIncident(req, res, await readJsonBody(req));
    }

    const incidentActionMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/(acknowledge|escalate)$/);
    if (req.method === "POST" && incidentActionMatch) {
      return updateIncidentLifecycle(req, res, {
        incidentId: decodeURIComponent(incidentActionMatch[1]),
        action: incidentActionMatch[2],
        body: await readJsonBody(req)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/incidents") {
      return sendOperatorReadJson(req, res, readDb().incidents.slice().reverse());
    }

    if (req.method === "GET" && url.pathname === "/api/incidents/sla") {
      return sendOperatorReadJson(req, res, buildSlaSummary(readDb().incidents));
    }

    if (req.method === "POST" && url.pathname === "/api/evidence/manifests") {
      return createEvidenceManifest(req, res, await readJsonBody(req));
    }

    if (req.method === "GET" && url.pathname === "/api/evidence/manifests") {
      return sendOperatorReadJson(req, res, readDb().evidence.slice().reverse().map(publicEvidenceManifest));
    }

    const evidenceAssetMatch = url.pathname.match(/^\/api\/evidence\/assets\/([^/]+)\/(\d+)$/);
    if (req.method === "GET" && evidenceAssetMatch) {
      return serveEvidenceAsset(req, res, {
        manifestId: decodeURIComponent(evidenceAssetMatch[1]),
        assetIndex: Number(evidenceAssetMatch[2])
      });
    }

    if (req.method === "POST" && url.pathname === "/api/evidence/retention/run") {
      return runEvidenceRetention(req, res, await readJsonBody(req));
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      return sendOperatorReadJson(req, res, readDb().audits.slice().reverse());
    }

    if (req.method === "GET" && url.pathname === "/api/metrics") {
      return sendOperatorReadJson(req, res, buildMetrics(readDb()));
    }

    return notFound(res);
  } catch (error) {
    console.error(error);
    if (error.statusCode === 400) return badRequest(res, error.message);
    if (error.statusCode === 413) return payloadTooLarge(res, error.message);
    return sendJson(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Control API listening on http://localhost:${PORT}`);
});

function registerCamera(req, res, body) {
  const { cameraId, name, edgeNodeId, location, streamUri } = body;
  if (!cameraId || !name || !edgeNodeId) {
    return badRequest(res, "cameraId, name and edgeNodeId are required");
  }

  const issuedKey = issueDeviceKey();
  const result = updateDb((db) => {
    let camera = db.cameras.find((item) => item.cameraId === cameraId);
    if (!camera) {
      camera = {
        cameraId,
        name,
        edgeNodeId,
        location: location || "unknown",
        streamUri: streamUri || null,
        deviceKeyHash: hashDeviceKey(issuedKey),
        status: "ONLINE",
        registeredAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString()
      };
      db.cameras.push(camera);
      appendAudit(db, { actor: edgeNodeId, action: "camera.registered", resource: cameraId, requestId: req.headers["idempotency-key"] });
    } else {
      camera.deviceKeyHash = hashDeviceKey(issuedKey);
      delete camera.deviceKey;
      camera.status = "ONLINE";
      camera.lastHeartbeat = new Date().toISOString();
      appendAudit(db, { actor: edgeNodeId, action: "camera.reconnected_key_issued", resource: cameraId, requestId: req.headers["idempotency-key"] });
    }
    return publicCameraWithIssuedKey(camera, issuedKey);
  });

  return sendJson(res, 200, result);
}

function updateCameraHealth(req, res, body) {
  const auth = authenticateCamera(req, body.cameraId);
  if (!auth.ok) return unauthorized(res, auth.message);

  const validation = validateContract(schemas.cameraHealth, body, "CameraHealth");
  if (!validation.valid) return badRequest(res, "CameraHealth contract failed", validation.errors);

  const result = updateDb((db) => {
    const camera = db.cameras.find((item) => item.cameraId === body.cameraId);
    camera.status = body.status;
    camera.lastHeartbeat = body.ingestTime;
    camera.lastQuality = body.quality || null;
    camera.lastStream = body.stream || null;
    appendAudit(db, { actor: body.edgeNodeId, action: "camera.health", resource: body.cameraId, requestId: req.headers["idempotency-key"] });
    return camera;
  });

  return sendJson(res, 202, result);
}

function rotateCameraKey(req, res, body) {
  const auth = authenticateCamera(req, body.cameraId);
  if (!auth.ok) return unauthorized(res, auth.message);

  const issuedKey = issueDeviceKey();
  const result = updateDb((db) => {
    const camera = db.cameras.find((item) => item.cameraId === body.cameraId);
    camera.deviceKeyHash = hashDeviceKey(issuedKey);
    delete camera.deviceKey;
    camera.keyRotatedAt = new Date().toISOString();
    appendAudit(db, { actor: body.cameraId, action: "camera.key_rotated", resource: body.cameraId, requestId: req.headers["idempotency-key"] });
    return publicCameraWithIssuedKey(camera, issuedKey);
  });

  return sendJson(res, 200, result);
}

async function createIncident(req, res, body) {
  const auth = authenticateCamera(req, body.cameraId);
  if (!auth.ok) return unauthorized(res, auth.message);

  const validation = validateContract(schemas.incident, body, "IncidentEvent");
  if (!validation.valid) return badRequest(res, "IncidentEvent contract failed", validation.errors);

  const idempotencyKey = req.headers["idempotency-key"] || body.eventId;
  const result = updateDb((db) => {
    const existing = db.incidents.find((item) => item.idempotencyKey === idempotencyKey || item.eventId === body.eventId);
    if (existing) return { incident: existing, created: false };

    const incident = {
      ...body,
      idempotencyKey,
      status: "OPEN",
      receivedAt: new Date().toISOString()
    };
    db.incidents.push(incident);
    appendAudit(db, { actor: body.cameraId, action: "incident.created", resource: body.incidentId, requestId: idempotencyKey });
    publishEvent("incident.created", incident);
    return { incident, created: true };
  });

  if (result.created) await notifyAndAudit("incident.created", result.incident, idempotencyKey);
  return sendJson(res, result.created ? 201 : 200, result.incident);
}

async function updateIncidentLifecycle(req, res, { incidentId, action, body }) {
  const permission = action === "acknowledge" ? "incident:acknowledge" : "incident:escalate";
  const auth = authenticateOperator(req, { requiredPermission: permission });
  if (!auth.ok) return auth.statusCode === 403 ? forbidden(res, auth.message) : unauthorized(res, auth.message);

  const result = updateDb((db) => {
    const incident = db.incidents.find((item) => item.incidentId === incidentId);
    if (!incident) return { found: false };

    const now = new Date().toISOString();
    if (action === "acknowledge") {
      incident.status = "ACKNOWLEDGED";
      incident.acknowledgedAt = now;
      incident.acknowledgedBy = auth.operator.operatorId;
      incident.acknowledgementNote = String(body.note || "").slice(0, 500) || null;
    } else {
      incident.status = "ESCALATED";
      incident.escalatedAt = now;
      incident.escalatedBy = auth.operator.operatorId;
      incident.escalationTarget = String(body.target || "command").slice(0, 120);
      incident.escalationNote = String(body.note || "").slice(0, 500) || null;
    }

    const auditAction = action === "acknowledge" ? "incident.acknowledged" : "incident.escalated";
    appendAudit(db, {
      actor: auth.operator.operatorId,
      action: auditAction,
      resource: incident.incidentId,
      requestId: req.headers["idempotency-key"]
    });
    publishEvent(auditAction, incident);
    return { found: true, incident };
  });

  if (!result.found) return notFound(res);
  if (action === "escalate") await notifyAndAudit("incident.escalated", result.incident, req.headers["idempotency-key"]);
  return sendJson(res, 200, result.incident);
}

async function notifyAndAudit(eventName, incident, requestId) {
  const result = await notifyIncidentEvent({ eventName, incident });
  if (result.skipped) return result;

  updateDb((db) => {
    appendAudit(db, {
      actor: "control-api",
      action: result.delivered ? "notification.delivered" : "notification.failed",
      resource: incident.incidentId,
      requestId
    });
    return null;
  });
  return result;
}

function createEvidenceManifest(req, res, body) {
  const incident = readDb().incidents.find((item) => item.incidentId === body.incidentId);
  const cameraId = incident?.cameraId || req.headers["x-camera-id"];
  const auth = authenticateCamera(req, cameraId);
  if (!auth.ok) return unauthorized(res, auth.message);

  const validation = validateContract(schemas.evidence, body, "EvidenceManifest");
  if (!validation.valid) return badRequest(res, "EvidenceManifest contract failed", validation.errors);

  const evidenceCheck = verifyEvidenceManifest(body);
  if (!evidenceCheck.valid) return badRequest(res, "EvidenceManifest verification failed", evidenceCheck.errors);

  const result = updateDb((db) => {
    const existing = db.evidence.find((item) => item.manifestId === body.manifestId);
    if (existing) return { manifest: existing, created: false };

    const manifest = {
      ...body,
      receivedAt: new Date().toISOString(),
      status: "VERIFIED"
    };
    db.evidence.push(manifest);
    appendAudit(db, { actor: cameraId, action: "evidence.verified", resource: body.manifestId, requestId: req.headers["idempotency-key"] });
    return { manifest, created: true };
  });

  return sendJson(res, result.created ? 201 : 200, result.manifest);
}

function sendOperatorReadJson(req, res, payload) {
  const auth = authenticateOperator(req, { requiredPermission: "incident:read" });
  if (!auth.ok) return auth.statusCode === 403 ? forbidden(res, auth.message) : unauthorized(res, auth.message);
  return sendJson(res, 200, payload);
}

function publicEvidenceManifest(manifest) {
  const { assets = [], keyframeUri, clipUri, ...safeManifest } = manifest;
  return {
    ...safeManifest,
    assetCount: assets.length,
    assets: assets.map((asset, index) => ({
      kind: asset.kind,
      sha256: asset.sha256,
      contentType: asset.contentType || null,
      assetUrl: `/api/evidence/assets/${encodeURIComponent(manifest.manifestId)}/${index}`
    }))
  };
}

function serveEvidenceAsset(req, res, { manifestId, assetIndex }) {
  const auth = authenticateOperator(req, { requiredPermission: "incident:read" });
  if (!auth.ok) return auth.statusCode === 403 ? forbidden(res, auth.message) : unauthorized(res, auth.message);

  const manifest = readDb().evidence.find((item) => item.manifestId === manifestId);
  if (!manifest || manifest.status !== "VERIFIED") return notFound(res);

  const asset = manifest.assets?.[assetIndex];
  if (!asset || !asset.uri?.startsWith("file://")) return notFound(res);

  const assetPath = resolveEvidenceAssetPath(asset.uri);
  if (!assetPath) return forbidden(res, "evidence asset path is outside configured evidence storage");
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) return notFound(res);

  const actualHash = verifyEvidenceAssetHash(assetPath);
  if (actualHash !== asset.sha256) {
    return sendJson(res, 409, {
      error: "evidence_hash_mismatch",
      message: "stored evidence asset does not match its verified manifest hash"
    });
  }

  const contentType = asset.contentType || inferEvidenceContentType(assetPath);
  res.writeHead(200, withSecurityHeaders({
    "content-type": contentType,
    "content-length": String(fs.statSync(assetPath).size),
    "cache-control": "no-store",
    "content-disposition": `inline; filename="${path.basename(assetPath).replaceAll('"', "")}"`
  }));
  fs.createReadStream(assetPath).pipe(res);
}

function runEvidenceRetention(req, res, body) {
  const auth = authenticateOperator(req, { requiredPermission: "incident:escalate" });
  if (!auth.ok) return auth.statusCode === 403 ? forbidden(res, auth.message) : unauthorized(res, auth.message);

  const result = updateDb((db) => {
    const retention = expireEvidenceManifests(db, {
      now: body.now ? new Date(body.now) : new Date(),
      retentionDays: body.retentionDays === undefined ? undefined : Number(body.retentionDays),
      deleteLocalFiles: body.deleteLocalFiles
    });
    appendAudit(db, {
      actor: auth.operator.operatorId,
      action: "evidence.retention_run",
      resource: `expired:${retention.expired.length}`,
      requestId: req.headers["idempotency-key"]
    });
    return { ...retention, summary: buildRetentionSummary(db) };
  });

  return sendJson(res, 200, result);
}

function authenticateCamera(req, cameraId) {
  const deviceKey = req.headers["x-device-key"];
  if (!cameraId) return { ok: false, message: "cameraId is required" };
  if (!deviceKey) return { ok: false, message: "x-device-key header is required" };

  const camera = readDb().cameras.find((item) => item.cameraId === cameraId);
  if (!camera) return { ok: false, message: "camera is not registered" };
  if (!verifyDeviceKey({ providedKey: deviceKey, storedHash: camera.deviceKeyHash, legacyPlaintextKey: camera.deviceKey })) {
    return { ok: false, message: "device key mismatch" };
  }
  return { ok: true, camera };
}

function resolveEvidenceAssetPath(uri) {
  const evidenceRoot = path.resolve(process.env.EVIDENCE_DIR || path.join(root, "edge/edge-agent/data/evidence"));
  const rawPath = decodeURIComponent(uri.replace("file://", ""));
  const assetPath = path.resolve(rawPath);
  const relative = path.relative(evidenceRoot, assetPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return assetPath;
  }
  return null;
}

function verifyEvidenceAssetHash(assetPath) {
  const buffer = fs.readFileSync(assetPath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function inferEvidenceContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function serveStaticUi(res, pathname) {
  const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.join(uiDir, fileName);
  if (!filePath.startsWith(uiDir) || !fs.existsSync(filePath)) return notFound(res);

  const ext = path.extname(filePath);
  const contentType = ext === ".html" ? "text/html; charset=utf-8"
    : ext === ".js" ? "text/javascript; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
        : "application/octet-stream";

  res.writeHead(200, withSecurityHeaders({ "content-type": contentType }));
  res.end(fs.readFileSync(filePath));
}

function openEventStream(req, res) {
  res.writeHead(200, withSecurityHeaders({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "access-control-allow-origin": "*"
  }));
  res.write(`event: ready\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);

  const client = { res };
  eventClients.add(client);
  req.on("close", () => eventClients.delete(client));
}

function publishEvent(eventName, payload) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) {
    client.res.write(message);
  }
}

function buildMetrics(db) {
  const incidentsBySeverity = db.incidents.reduce((acc, incident) => {
    acc[incident.severity] = (acc[incident.severity] || 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: "control-metrics.v1",
    generatedAt: new Date().toISOString(),
    cameras: {
      total: db.cameras.length,
      online: db.cameras.filter((camera) => camera.status === "ONLINE").length
    },
    incidents: {
      total: db.incidents.length,
      open: db.incidents.filter((incident) => incident.status === "OPEN").length,
      bySeverity: incidentsBySeverity,
      sla: buildSlaSummary(db.incidents)
    },
    evidence: {
      verified: db.evidence.filter((item) => item.status === "VERIFIED").length,
      expired: db.evidence.filter((item) => item.status === "EXPIRED").length
    },
    audit: {
      total: db.audits.length
    }
  };
}
