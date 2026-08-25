import { adaptFrameDetections } from "./track-event-adapter.mjs";

const model = {
  name: "simulated-yolo-bytetrack-adapter",
  version: "0.2.0",
  checksum: "sha256:simulation"
};

export function buildSimulatedTrackEvents({ cameraId = "cam-bop-01-east", startedAt = Date.now() } = {}) {
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
  return events;
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  for (const event of buildSimulatedTrackEvents()) {
    console.log(JSON.stringify(event));
  }
}
