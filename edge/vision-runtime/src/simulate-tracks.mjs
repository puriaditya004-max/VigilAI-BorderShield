import { adaptFrameDetections } from "./track-event-adapter.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const model = {
  name: "simulated-yolo-bytetrack-adapter",
  version: "0.2.0",
  checksum: "sha256:simulation"
};

export function buildSimulatedTrackEvents({
  cameraId = "cam-bop-01-east",
  startedAt = Date.now(),
  includeSuspiciousActivity = false,
  includeNightWatch = false
} = {}) {
  const state = new Map();
  const frames = [
    [{ classId: 0, className: "person", confidence: 0.89, trackId: "trk-person-001", bbox: [560, 210, 632, 395] }],
    [{ classId: 0, className: "person", confidence: 0.92, trackId: "trk-person-001", bbox: [596, 211, 668, 397] }],
    [{ classId: 0, className: "person", confidence: 0.93, trackId: "trk-person-001", bbox: [632, 213, 704, 399] }],
    [{ classId: 2, className: "car", confidence: 0.86, trackId: "trk-vehicle-002", bbox: [220, 310, 360, 390] }]
  ];

  const events = [];
  for (const [index, detections] of frames.entries()) {
    const frameTime = new Date(startedAt + index * 1000).toISOString();
    const adapted = adaptFrameDetections({ cameraId, frameTime, detections, model, state });
    events.push(...adapted.events);
  }

  if (includeSuspiciousActivity) {
    events.push(...buildSuspiciousActivityFixture({ cameraId, startedAt: startedAt + 5000 }));
  }
  if (includeNightWatch) {
    events.push(buildNightWatchFixture({ cameraId, startedAt: startedAt + 9000 }));
  }

  return events;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  for (const event of buildSimulatedTrackEvents(options)) {
    console.log(JSON.stringify(event));
  }
}

function buildSuspiciousActivityFixture({ cameraId, startedAt }) {
  const first = new Date(startedAt).toISOString();
  const second = new Date(startedAt + 31000).toISOString();
  return [
    fixtureTrackEvent({ cameraId, trackId: "trk-loitering-fixture", x: 220, y: 360, captureTime: first }),
    fixtureTrackEvent({ cameraId, trackId: "trk-loitering-fixture", x: 225, y: 362, captureTime: second })
  ];
}

function buildNightWatchFixture({ cameraId, startedAt }) {
  return fixtureTrackEvent({
    cameraId,
    trackId: "trk-night-watch-fixture",
    x: 340,
    y: 340,
    captureTime: new Date(startedAt).toISOString(),
    frameAnalysis: {
      frameId: `frame-night-watch-${startedAt}`,
      brightness: 0.03,
      contrast: 0.02,
      sharpness: 0.02,
      blockedRatio: 0.82,
      signalLost: false
    }
  });
}

function fixtureTrackEvent({ cameraId, trackId, x, y, captureTime, frameAnalysis }) {
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-${trackId}-${Date.parse(captureTime)}`,
    cameraId,
    trackId,
    objectClass: "PERSON",
    confidence: 0.9,
    bbox: { x: x - 30, y: y - 150, width: 60, height: 150 },
    trajectory: [{ x, y, t: captureTime }],
    captureTime,
    model,
    ...(frameAnalysis ? { frameAnalysis } : {})
  };
}

function parseArgs(argv) {
  return {
    includeSuspiciousActivity: argv.includes("--include-suspicious-activity"),
    includeNightWatch: argv.includes("--include-night-watch")
  };
}
