import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createTextEvidence } from "./evidence.mjs";
import { buildIntrusionIncident, crossedFence, FenceIncidentPolicy } from "./virtual-fence.mjs";
import { registerCamera, sendEvidence, sendHealth, sendIncident } from "./control-client.mjs";
import { enqueueIncident, replayOutbox } from "../../edge-agent/src/outbox.mjs";

const API_BASE = process.env.CONTROL_API_URL || "http://localhost:7080";
const cameraConfigPath = process.env.CAMERA_CONFIG || "edge/edge-agent/config/camera.json";
const zonesConfigPath = process.env.ZONES_CONFIG || "edge/analytics/config/zones.json";
const TRAJECTORY_HISTORY_POINTS = Number(process.env.TRACK_TRAJECTORY_HISTORY_POINTS || 20);

export async function runTrackBridge({ input = process.stdin, endpoint = API_BASE } = {}) {
  const camera = JSON.parse(fs.readFileSync(cameraConfigPath, "utf8"));
  const zones = JSON.parse(fs.readFileSync(zonesConfigPath, "utf8"));
  const registered = await registerCamera({ endpoint, camera });
  await sendHealth({ endpoint, camera, deviceKey: registered.deviceKey });

  const emitted = [];
  const crossingState = new Map();
  const trajectoryHistory = new Map();
  const fencePolicy = new FenceIncidentPolicy();
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;

    let trackEvent;
    try {
      trackEvent = JSON.parse(trimmed);
    } catch (error) {
      console.error(`Skipping invalid TrackEvent line: ${error.message}`);
      continue;
    }

    if (trackEvent.schemaVersion !== "track-event.v1") continue;
    const accumulatedTrackEvent = accumulateTrackTrajectory(trajectoryHistory, trackEvent);
    const matchingZones = zones.filter((zone) => zone.cameraId === accumulatedTrackEvent.cameraId);

    for (const zone of matchingZones) {
      const key = `${accumulatedTrackEvent.trackId}:${zone.zoneId}`;
      if (!crossedFence(accumulatedTrackEvent.trajectory, zone)) {
        crossingState.delete(key);
        continue;
      }

      const count = (crossingState.get(key) || 0) + 1;
      crossingState.set(key, count);
      if (count < (zone.persistenceFrames || 1)) continue;

      crossingState.delete(key);
      const decision = fencePolicy.evaluate({ trackEvent: accumulatedTrackEvent, zone });
      if (!decision.allowed) continue;

      const incidentHint = `inc-${accumulatedTrackEvent.cameraId}-${accumulatedTrackEvent.trackId}-${Date.parse(accumulatedTrackEvent.captureTime)}`;
      const evidence = createTextEvidence({ incidentHint, trackEvent: accumulatedTrackEvent, zone });
      const incident = buildIntrusionIncident({ trackEvent: accumulatedTrackEvent, zone, evidence, decision });

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

export function accumulateTrackTrajectory(history, trackEvent, { maxPoints = TRAJECTORY_HISTORY_POINTS } = {}) {
  const key = `${trackEvent.cameraId}:${trackEvent.trackId}`;
  const previous = history.get(key) || [];
  const incoming = normalizeTrajectory(trackEvent);
  const merged = mergeTrajectory(previous, incoming).slice(-maxPoints);
  history.set(key, merged);
  return { ...trackEvent, trajectory: merged };
}

function normalizeTrajectory(trackEvent) {
  const fallbackTime = trackEvent.captureTime || new Date().toISOString();
  return (trackEvent.trajectory || [])
    .filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
    .map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
      t: point.t || fallbackTime
    }));
}

function mergeTrajectory(previous, incoming) {
  const merged = [];
  const seen = new Set();
  for (const point of [...previous, ...incoming]) {
    const key = `${point.x}:${point.y}:${point.t || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(point);
  }
  return merged;
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
