import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(".");
const dbPath = path.join(root, "services/control-api/data/control-api.db.json");
const port = 7280;
const endpoint = `http://localhost:${port}`;
const camera = {
  cameraId: "cam-bop-01-east",
  name: "BOP 01 East Gate Camera",
  edgeNodeId: "edge-bop-01",
  location: "East perimeter",
  streamUri: "rtsp://camera.local/stream1"
};

if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });

const server = spawn(process.execPath, ["services/control-api/src/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth();
  const registered = await postJson("/api/cameras/register", camera, {});
  const oldKey = registered.deviceKey;
  const rotated = await postJson("/api/cameras/rotate-key", { cameraId: camera.cameraId }, { "x-device-key": oldKey });

  assert(rotated.deviceKey !== oldKey, "device key should rotate");

  const oldKeyResponse = await fetch(`${endpoint}/api/cameras/health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": oldKey },
    body: JSON.stringify(healthPayload())
  });
  assert(oldKeyResponse.status === 401, "old device key should be rejected");

  const newKeyResponse = await fetch(`${endpoint}/api/cameras/health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": rotated.deviceKey },
    body: JSON.stringify(healthPayload())
  });
  assert(newKeyResponse.status === 202, "new device key should be accepted");

  const audit = await fetchJson("/api/audit");
  assert(audit.some((event) => event.action === "camera.key_rotated"), "rotation audit missing");
  console.log("PASS device-key-rotation integration");
} finally {
  server.kill();
}

function healthPayload() {
  const now = new Date().toISOString();
  return {
    schemaVersion: "camera-health.v1",
    eventId: `evt-camera-health-${Date.now()}`,
    cameraId: camera.cameraId,
    edgeNodeId: camera.edgeNodeId,
    status: "ONLINE",
    captureTime: now,
    ingestTime: now,
    stream: { uri: camera.streamUri, codec: "H264", fps: 25 },
    quality: { blurScore: 0.1, darknessScore: 0.2, droppedFrames: 0 }
  };
}

async function postJson(route, body, headers) {
  const response = await fetch(`${endpoint}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

async function fetchJson(route) {
  const response = await fetch(`${endpoint}${route}`);
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`${endpoint}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("control-api did not start");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
