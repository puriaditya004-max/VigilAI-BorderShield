import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { enqueueIncident, listQueuedIncidents, replayOutbox } from "../../edge/edge-agent/src/outbox.mjs";

const root = path.resolve(".");
const dbPath = path.join(root, "services/control-api/data/control-api.db.json");
const outboxDir = path.join(root, "edge/edge-agent/outbox");
const cameraId = "cam-bop-01-east";
const registration = {
  cameraId,
  name: "BOP 01 East Gate Camera",
  edgeNodeId: "edge-bop-01",
  location: "East perimeter",
  streamUri: "rtsp://camera.local/stream1"
};

cleanup();

const queuedIncident = {
  schemaVersion: "incident-event.v1",
  eventId: "evt-outbox-replay-0001",
  incidentId: "inc-outbox-0001",
  cameraId,
  zoneId: "zone-east-fence",
  type: "VIRTUAL_FENCE_INTRUSION",
  severity: "HIGH",
  reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED"],
  captureTime: new Date().toISOString(),
  evidence: {
    manifestId: "manifest-outbox-0001",
    sha256: "8843d7f92416211de9ebb963ff4ce28125932878d0f560877c8fd78ea61ccf2b",
    keyframeUri: "file://queued-keyframe.txt",
    clipUri: "file://queued-clip.txt"
  }
};

enqueueIncident(queuedIncident);
assert(listQueuedIncidents().length === 1, "incident should be queued before replay");

const server = spawn(process.execPath, ["services/control-api/src/server.mjs"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth();
  const camera = await postJson("/api/cameras/register", registration, {});
  const replayed = await replayOutbox({ endpoint: "http://localhost:7080", deviceKey: camera.deviceKey });
  assert(replayed[0]?.status === "replayed", "outbox item should replay");
  assert(listQueuedIncidents().length === 0, "outbox should be empty after replay");

  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  assert(db.incidents.some((incident) => incident.incidentId === queuedIncident.incidentId), "replayed incident should persist");
  console.log("PASS offline-outbox-replay integration");
} finally {
  server.kill();
}

async function postJson(route, body, headers) {
  const response = await fetch(`http://localhost:7080${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch("http://localhost:7080/health");
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("control-api did not start");
}

function cleanup() {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
  if (!fs.existsSync(outboxDir)) return;
  for (const file of fs.readdirSync(outboxDir)) {
    if (file.endsWith(".json")) fs.rmSync(path.join(outboxDir, file), { force: true });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
