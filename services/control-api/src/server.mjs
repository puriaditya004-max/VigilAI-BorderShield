import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateContract, readJson } from "../../../packages/contracts/src/validate-contract.mjs";
import { appendAudit, ensureStore, readDb, updateDb } from "./store.mjs";
import { badRequest, notFound, readJsonBody, sendJson, unauthorized } from "./http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const PORT = Number(process.env.PORT || 7080);
const uiDir = path.join(root, "apps/command-ui/public");

const schemas = {
  incident: readJson(path.join(root, "packages/contracts/schemas/incident-event.schema.json")),
  cameraHealth: readJson(path.join(root, "packages/contracts/schemas/camera-health.schema.json"))
};

ensureStore();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, 204, {});

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/") || ["/main.js", "/styles.css"].includes(url.pathname))) {
      return serveStaticUi(res, url.pathname);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", service: "control-api", time: new Date().toISOString() });
    }

    if (req.method === "POST" && url.pathname === "/api/cameras/register") {
      return registerCamera(req, res, await readJsonBody(req));
    }

    if (req.method === "POST" && url.pathname === "/api/cameras/health") {
      return updateCameraHealth(req, res, await readJsonBody(req));
    }

    if (req.method === "GET" && url.pathname === "/api/cameras") {
      return sendJson(res, 200, readDb().cameras);
    }

    if (req.method === "GET" && url.pathname === "/api/zones") {
      return sendJson(res, 200, readDb().zones);
    }

    if (req.method === "POST" && url.pathname === "/api/incidents") {
      return createIncident(req, res, await readJsonBody(req));
    }

    if (req.method === "GET" && url.pathname === "/api/incidents") {
      return sendJson(res, 200, readDb().incidents.slice().reverse());
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      return sendJson(res, 200, readDb().audits.slice().reverse());
    }

    return notFound(res);
  } catch (error) {
    console.error(error);
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

  const result = updateDb((db) => {
    let camera = db.cameras.find((item) => item.cameraId === cameraId);
    if (!camera) {
      camera = {
        cameraId,
        name,
        edgeNodeId,
        location: location || "unknown",
        streamUri: streamUri || null,
        deviceKey: `dev_${crypto.randomBytes(24).toString("hex")}`,
        status: "ONLINE",
        registeredAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString()
      };
      db.cameras.push(camera);
      appendAudit(db, { actor: edgeNodeId, action: "camera.registered", resource: cameraId, requestId: req.headers["idempotency-key"] });
    } else {
      camera.status = "ONLINE";
      camera.lastHeartbeat = new Date().toISOString();
      appendAudit(db, { actor: edgeNodeId, action: "camera.reconnected", resource: cameraId, requestId: req.headers["idempotency-key"] });
    }
    return camera;
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

function createIncident(req, res, body) {
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
    return { incident, created: true };
  });

  return sendJson(res, result.created ? 201 : 200, result.incident);
}

function authenticateCamera(req, cameraId) {
  const deviceKey = req.headers["x-device-key"];
  if (!cameraId) return { ok: false, message: "cameraId is required" };
  if (!deviceKey) return { ok: false, message: "x-device-key header is required" };

  const camera = readDb().cameras.find((item) => item.cameraId === cameraId);
  if (!camera) return { ok: false, message: "camera is not registered" };
  if (camera.deviceKey !== deviceKey) return { ok: false, message: "device key mismatch" };
  return { ok: true, camera };
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

  res.writeHead(200, { "content-type": contentType });
  res.end(fs.readFileSync(filePath));
}
