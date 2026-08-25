import fs from "node:fs";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";
import { enqueueIncident, listQueuedIncidents, replayOutbox } from "../../edge/edge-agent/src/outbox.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("offline-outbox");
process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;

const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const cameraId = "cam-bop-01-east";
const registration = {
  cameraId,
  name: "BOP 01 East Gate Camera",
  edgeNodeId: "edge-bop-01",
  location: "East perimeter",
  streamUri: "rtsp://camera.local/stream1"
};

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

let server;
try {
  server = await startControlApi({ cwd: root, port, env: ctx.env });
  const camera = await postJson(endpoint, "/api/cameras/register", registration, {});
  const replayed = await replayOutbox({ endpoint, deviceKey: camera.deviceKey });
  assert(replayed[0]?.status === "replayed", "outbox item should replay");
  assert(listQueuedIncidents().length === 0, "outbox should be empty after replay");

  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  assert(db.incidents.some((incident) => incident.incidentId === queuedIncident.incidentId), "replayed incident should persist");
  console.log("PASS offline-outbox-replay integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
  delete process.env.EDGE_OUTBOX_DIR;
}

async function postJson(endpoint, route, body, headers) {
  const response = await fetch(`${endpoint}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
