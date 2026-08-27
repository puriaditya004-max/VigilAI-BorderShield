import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("incident-lifecycle");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const camera = {
  cameraId: "cam-bop-01-east",
  name: "BOP 01 East Gate Camera",
  edgeNodeId: "edge-bop-01",
  location: "East perimeter",
  streamUri: "rtsp://camera.local/stream1"
};

let server;
try {
  server = await startControlApi({ cwd: root, port, env: ctx.env });
  const registered = await postJson("/api/cameras/register", camera, {});
  await postJson("/api/incidents", incidentPayload(), { "x-device-key": registered.deviceKey });

  const viewerAttempt = await fetch(`${endpoint}/api/incidents/inc-lifecycle-test/acknowledge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-operator-id": "viewer-1",
      "x-operator-role": "VIEWER"
    },
    body: JSON.stringify({ note: "not allowed" })
  });
  assert(viewerAttempt.status === 403, "viewer should not acknowledge incidents");

  const acknowledged = await postJson("/api/incidents/inc-lifecycle-test/acknowledge", { note: "seen" }, {
    "x-operator-id": "operator-1",
    "x-operator-role": "OPERATOR"
  });
  assert(acknowledged.status === "ACKNOWLEDGED", "incident should be acknowledged");
  assert(acknowledged.acknowledgedBy === "operator-1", "ack actor should be captured");

  const escalated = await postJson("/api/incidents/inc-lifecycle-test/escalate", { target: "sector-command", note: "dispatch" }, {
    "x-operator-id": "commander-1",
    "x-operator-role": "COMMANDER"
  });
  assert(escalated.status === "ESCALATED", "incident should be escalated");
  assert(escalated.escalatedBy === "commander-1", "escalation actor should be captured");

  const audit = await fetchJson("/api/audit");
  assert(audit.some((event) => event.action === "incident.acknowledged"), "ack audit missing");
  assert(audit.some((event) => event.action === "incident.escalated"), "escalation audit missing");

  console.log("PASS incident-lifecycle integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

function incidentPayload() {
  return {
    schemaVersion: "incident-event.v1",
    eventId: "evt-inc-lifecycle-test",
    incidentId: "inc-lifecycle-test",
    cameraId: camera.cameraId,
    zoneId: "zone-east-fence",
    type: "VIRTUAL_FENCE_INTRUSION",
    severity: "CRITICAL",
    reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED"],
    captureTime: "2026-08-26T00:00:00.000Z",
    evidence: { manifestId: "manifest-lifecycle-test", sha256: "d".repeat(64) }
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
  const response = await fetch(`${endpoint}${route}`, {
    headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
