import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("realtime-events");
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
let streamAbort;
try {
  server = await startControlApi({ cwd: root, port, env: ctx.env });
  streamAbort = new AbortController();
  const streamPromise = waitForIncidentEvent(streamAbort.signal);
  await sleep(100);

  const registered = await postJson("/api/cameras/register", camera, {});
  await postJson("/api/incidents", incidentPayload(), {
    "x-device-key": registered.deviceKey,
    "idempotency-key": "idem-realtime-test"
  });

  const event = await streamPromise;
  assert(event.incidentId === "inc-realtime-test", "expected incident SSE payload");
  console.log("PASS realtime-events integration");
} finally {
  streamAbort?.abort();
  await stopProcess(server);
  cleanupRuntime(ctx);
}

function incidentPayload() {
  return {
    schemaVersion: "incident-event.v1",
    eventId: "evt-inc-realtime-test",
    incidentId: "inc-realtime-test",
    cameraId: camera.cameraId,
    zoneId: "zone-east-fence",
    type: "VIRTUAL_FENCE_INTRUSION",
    severity: "HIGH",
    reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED"],
    captureTime: "2026-08-26T00:00:00.000Z",
    evidence: { manifestId: "manifest-realtime-test", sha256: "c".repeat(64) }
  };
}

async function waitForIncidentEvent(signal) {
  const response = await fetch(`${endpoint}/api/events`, { signal });
  if (!response.ok) throw new Error(`/api/events failed with ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const started = Date.now();

  while (Date.now() - started < 5000) {
    const { value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const event = parseIncidentEvent(buffer);
    if (event) return event;
  }

  throw new Error("timed out waiting for incident SSE event");
}

function parseIncidentEvent(buffer) {
  const messages = buffer.split("\n\n");
  for (const message of messages) {
    if (!message.includes("event: incident.created")) continue;
    const dataLine = message.split("\n").find((line) => line.startsWith("data: "));
    if (dataLine) return JSON.parse(dataLine.slice("data: ".length));
  }
  return null;
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
