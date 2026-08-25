import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createTextEvidence } from "./evidence.mjs";
import { buildIntrusionIncident, crossedFence } from "./virtual-fence.mjs";
import { registerCamera, sendEvidence, sendHealth, sendIncident } from "./control-client.mjs";
import { enqueueIncident, replayOutbox } from "../../edge-agent/src/outbox.mjs";

const API_BASE = process.env.CONTROL_API_URL || "http://localhost:7080";
const cameraConfigPath = process.env.CAMERA_CONFIG || "edge/edge-agent/config/camera.json";
const zonesConfigPath = process.env.ZONES_CONFIG || "edge/analytics/config/zones.json";

export async function runTrackBridge({ input = process.stdin, endpoint = API_BASE } = {}) {
  const camera = JSON.parse(fs.readFileSync(cameraConfigPath, "utf8"));
  const zones = JSON.parse(fs.readFileSync(zonesConfigPath, "utf8"));
  const registered = await registerCamera({ endpoint, camera });
  await sendHealth({ endpoint, camera, deviceKey: registered.deviceKey });

  const emitted = [];
  const crossingState = new Map();
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    if (!line.trim()) continue;
    const trackEvent = JSON.parse(line);
    const matchingZones = zones.filter((zone) => zone.cameraId === trackEvent.cameraId);

    for (const zone of matchingZones) {
      const key = `${trackEvent.trackId}:${zone.zoneId}`;
      if (!crossedFence(trackEvent.trajectory, zone)) {
        crossingState.delete(key);
        continue;
      }

      const count = (crossingState.get(key) || 0) + 1;
      crossingState.set(key, count);
      if (count < (zone.persistenceFrames || 1)) continue;

      crossingState.delete(key);
      const incidentHint = `inc-${trackEvent.cameraId}-${trackEvent.trackId}-${Date.parse(trackEvent.captureTime)}`;
      const evidence = createTextEvidence({ incidentHint, trackEvent, zone });
      const incident = buildIntrusionIncident({ trackEvent, zone, evidence });

      const accepted = await sendIncident({ endpoint, incident, deviceKey: registered.deviceKey }).catch(() => false);
      if (!accepted) {
        enqueueIncident(incident);
      } else {
        await sendEvidence({ endpoint, evidence, deviceKey: registered.deviceKey, cameraId: incident.cameraId });
        await replayOutbox({ endpoint, deviceKey: registered.deviceKey });
      }
      emitted.push(incident);
    }
  }

  return emitted;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const inputPath = process.argv.find((arg) => arg.startsWith("--input="))?.split("=")[1];
  const input = inputPath ? fs.createReadStream(inputPath) : process.stdin;
  runTrackBridge({ input }).then((incidents) => {
    console.log(JSON.stringify({ incidents: incidents.length }));
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
