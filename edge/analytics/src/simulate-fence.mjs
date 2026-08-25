import { buildIntrusionIncident, crossedFence } from "./virtual-fence.mjs";
import { createTextEvidence } from "./evidence.mjs";
import { enqueueIncident, replayOutbox } from "../../edge-agent/src/outbox.mjs";
import { buildSimulatedTrackEvents } from "../../vision-runtime/src/simulate-tracks.mjs";

const API_BASE = process.env.CONTROL_API_URL || "http://localhost:7080";
const CAMERA_ID = "cam-bop-01-east";
const EDGE_NODE_ID = "edge-bop-01";

const cameraRegistration = {
  cameraId: CAMERA_ID,
  name: "BOP 01 East Gate Camera",
  edgeNodeId: EDGE_NODE_ID,
  location: "East perimeter",
  streamUri: "rtsp://camera.local/stream1"
};

const zone = {
  zoneId: "zone-east-fence",
  cameraId: CAMERA_ID,
  name: "East virtual fence",
  line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
  direction: "LEFT_TO_RIGHT",
  severity: "HIGH"
};

async function main() {
  const camera = await registerCamera();
  await sendHealth(camera.deviceKey);

  const trackEvent = buildSimulatedTrackEvents({ cameraId: CAMERA_ID })
    .filter((event) => event.objectClass === "PERSON")
    .at(-1);

  if (!crossedFence(trackEvent.trajectory, zone)) {
    console.log("No intrusion generated.");
    return;
  }

  const evidence = createTextEvidence({ incidentHint: "inc-bop-sim-0001", trackEvent, zone });
  const incident = buildIntrusionIncident({ trackEvent, zone, evidence });

  const sent = await sendIncident(incident, camera.deviceKey);
  if (!sent) {
    const file = enqueueIncident(incident);
    console.log(`Control API unavailable; incident queued at ${file}`);
    return;
  }

  const replayed = await replayOutbox({ endpoint: API_BASE, deviceKey: camera.deviceKey });
  console.log(`Incident accepted: ${incident.incidentId}`);
  console.log(`Outbox replay results: ${JSON.stringify(replayed)}`);
}

async function registerCamera() {
  const response = await fetch(`${API_BASE}/api/cameras/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `register-${CAMERA_ID}` },
    body: JSON.stringify(cameraRegistration)
  });
  if (!response.ok) throw new Error(`camera registration failed: ${response.status}`);
  return response.json();
}

async function sendHealth(deviceKey) {
  const now = new Date().toISOString();
  const response = await fetch(`${API_BASE}/api/cameras/health`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey,
      "idempotency-key": `health-${CAMERA_ID}-${Date.now()}`
    },
    body: JSON.stringify({
      schemaVersion: "camera-health.v1",
      eventId: `evt-camera-health-${Date.now()}`,
      cameraId: CAMERA_ID,
      edgeNodeId: EDGE_NODE_ID,
      status: "ONLINE",
      captureTime: now,
      ingestTime: now,
      stream: { uri: cameraRegistration.streamUri, codec: "H264", fps: 25 },
      quality: { blurScore: 0.1, darknessScore: 0.2, droppedFrames: 0 }
    })
  });
  if (!response.ok) throw new Error(`camera health failed: ${response.status}`);
}

async function sendIncident(incident, deviceKey) {
  try {
    const response = await fetch(`${API_BASE}/api/incidents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-key": deviceKey,
        "idempotency-key": incident.eventId
      },
      body: JSON.stringify(incident)
    });
    return response.ok;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
