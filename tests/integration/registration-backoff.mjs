import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  listFiles
} from "../helpers/runtime.mjs";

const ctx = createRuntimeContext("registration-backoff");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const cameraConfigPath = path.join(ctx.root, "camera.json");
const zonesConfigPath = path.join(ctx.root, "zones.json");
const previous = snapshotEnv([
  "EVIDENCE_DIR",
  "EDGE_OUTBOX_DIR",
  "EDGE_REGISTER_BACKOFF_BASE_MS",
  "EDGE_REGISTER_BACKOFF_MAX_MS",
  "EDGE_OUTBOX_REPLAY_BACKOFF_BASE_MS",
  "EDGE_OUTBOX_REPLAY_BACKOFF_MAX_MS"
]);

const observed = {
  registrationAttempts: 0,
  incidents: [],
  evidence: []
};

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/cameras/register") {
    observed.registrationAttempts += 1;
    await drain(req);
    if (observed.registrationAttempts <= 2) {
      return sendJson(res, 429, { error: "rate_limited" });
    }
    return sendJson(res, 200, { ...camera(), deviceKey: "dev-backoff-test" });
  }

  if (req.method === "POST" && req.url === "/api/cameras/health") {
    await drain(req);
    return sendJson(res, 202, {});
  }

  if (req.method === "POST" && req.url === "/api/incidents") {
    observed.incidents.push(JSON.parse(await readText(req)));
    return sendJson(res, 201, observed.incidents.at(-1));
  }

  if (req.method === "POST" && req.url === "/api/evidence/manifests") {
    observed.evidence.push(JSON.parse(await readText(req)));
    return sendJson(res, 201, observed.evidence.at(-1));
  }

  return sendJson(res, 404, { error: "not_found" });
});

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  process.env.EDGE_REGISTER_BACKOFF_BASE_MS = "20";
  process.env.EDGE_REGISTER_BACKOFF_MAX_MS = "40";
  process.env.EDGE_OUTBOX_REPLAY_BACKOFF_BASE_MS = "20";
  process.env.EDGE_OUTBOX_REPLAY_BACKOFF_MAX_MS = "40";

  fs.writeFileSync(cameraConfigPath, `${JSON.stringify(camera(), null, 2)}\n`);
  fs.writeFileSync(zonesConfigPath, `${JSON.stringify([zone()], null, 2)}\n`);

  await new Promise((resolve) => server.listen(port, resolve));
  const { runTrackBridge } = await import(`../../edge/analytics/src/track-bridge.mjs?registration-backoff=${Date.now()}`);
  const emitted = await runTrackBridge({
    input: Readable.from(backoffTrackEvents()),
    endpoint,
    cameraConfig: cameraConfigPath,
    zonesConfig: zonesConfigPath
  });

  assert(emitted.length === 6, "all six crossing incidents should still be emitted by bridge analytics");
  assert(observed.registrationAttempts <= 3, `registration attempts should be bounded by backoff, got ${observed.registrationAttempts}`);
  assert(observed.registrationAttempts === 3, "registration should retry after backoff and eventually succeed");
  assert(observed.incidents.length === 6, "current and queued incidents should sync after registration succeeds");
  assert(listFiles(ctx.outboxDir, ".json").length === 0, "outbox should be empty after successful replay");

  console.log("PASS registration-backoff integration");
} finally {
  await new Promise((resolve) => server.close(resolve));
  restoreEnv(previous);
  cleanupRuntime(ctx);
}

async function* backoffTrackEvents() {
  for (let index = 0; index < 4; index += 1) {
    yield `${JSON.stringify(trackEvent({ trackId: `burst-${index}`, x: 600, second: index * 2 }))}\n`;
    yield `${JSON.stringify(trackEvent({ trackId: `burst-${index}`, x: 670, second: index * 2 + 1 }))}\n`;
  }

  await sleep(25);
  yield `${JSON.stringify(trackEvent({ trackId: "retry-once", x: 600, second: 20 }))}\n`;
  yield `${JSON.stringify(trackEvent({ trackId: "retry-once", x: 670, second: 21 }))}\n`;

  await sleep(45);
  yield `${JSON.stringify(trackEvent({ trackId: "register-success", x: 600, second: 30 }))}\n`;
  yield `${JSON.stringify(trackEvent({ trackId: "register-success", x: 670, second: 31 }))}\n`;
}

function trackEvent({ trackId, x, second }) {
  const captureTime = new Date(Date.parse("2026-08-28T00:00:00.000Z") + second * 1000).toISOString();
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-backoff-${trackId}-${x}`,
    cameraId: "cam-bop-01-east",
    trackId,
    objectClass: "PERSON",
    confidence: 0.9,
    bbox: { x: x - 30, y: 120, width: 60, height: 160 },
    trajectory: [{ x, y: 300, t: captureTime }],
    captureTime,
    model: {
      name: "registration-backoff-fixture",
      version: "fixture",
      checksum: "sha256:test"
    }
  };
}

function camera() {
  return {
    cameraId: "cam-bop-01-east",
    name: "BOP 01 East Gate Camera",
    edgeNodeId: "edge-bop-01",
    location: "East perimeter",
    streamUri: "rtsp://camera.local/stream1"
  };
}

function zone() {
  return {
    zoneId: "zone-east-fence",
    cameraId: "cam-bop-01-east",
    name: "East virtual fence",
    line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
    direction: "LEFT_TO_RIGHT",
    severity: "HIGH",
    persistenceFrames: 1,
    minTrajectoryPoints: 2,
    objectClasses: ["PERSON"],
    cooldownMs: 0
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readText(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function drain(req) {
  await readText(req);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
