import { buildIntrusionIncident, crossedFence } from "./virtual-fence.mjs";
import { createTextEvidence } from "./evidence.mjs";
import { registerCamera, sendEvidence, sendHealth, sendIncident } from "./control-client.mjs";
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
  const camera = await registerCamera({ endpoint: API_BASE, camera: cameraRegistration });
  await sendHealth({ endpoint: API_BASE, camera: cameraRegistration, deviceKey: camera.deviceKey });

  const trackEvent = buildSimulatedTrackEvents({ cameraId: CAMERA_ID })
    .filter((event) => event.objectClass === "PERSON")
    .at(-1);

  if (!crossedFence(trackEvent.trajectory, zone)) {
    console.log("No intrusion generated.");
    return;
  }

  const evidence = createTextEvidence({ incidentHint: "inc-bop-sim-0001", trackEvent, zone });
  const incident = buildIntrusionIncident({ trackEvent, zone, evidence });

  const sent = await sendIncident({ endpoint: API_BASE, incident, deviceKey: camera.deviceKey }).catch(() => false);
  if (!sent) {
    const file = enqueueIncident(incident);
    console.log(`Control API unavailable; incident queued at ${file}`);
    return;
  }

  await sendEvidence({ endpoint: API_BASE, evidence, deviceKey: camera.deviceKey, cameraId: incident.cameraId });
  const replayed = await replayOutbox({ endpoint: API_BASE, deviceKey: camera.deviceKey });
  console.log(`Incident accepted: ${incident.incidentId}`);
  console.log(`Outbox replay results: ${JSON.stringify(replayed)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
