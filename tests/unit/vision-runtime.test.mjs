import assert from "node:assert/strict";
import { adaptFrameDetections, detectionToObjectClass } from "../../edge/vision-runtime/src/track-event-adapter.mjs";
import { buildSimulatedTrackEvents } from "../../edge/vision-runtime/src/simulate-tracks.mjs";
import { crossedFence } from "../../edge/analytics/src/virtual-fence.mjs";
import { readJson, validateContract } from "../../packages/contracts/src/validate-contract.mjs";

const schema = readJson("packages/contracts/schemas/track-event.schema.json");

assert.equal(detectionToObjectClass({ classId: 0, className: "person" }), "PERSON");
assert.equal(detectionToObjectClass({ classId: 2, className: "car" }), "VEHICLE");
assert.equal(detectionToObjectClass({ classId: 67, className: "cell phone" }), null);

const state = new Map();
const first = adaptFrameDetections({
  cameraId: "cam-test",
  frameTime: "2026-08-25T16:30:00.000Z",
  detections: [{ classId: 0, confidence: 0.9, trackId: "trk-1", bbox: [10, 20, 60, 120] }],
  model: { name: "test", version: "1", checksum: "sha256:test" },
  state
});

const second = adaptFrameDetections({
  cameraId: "cam-test",
  frameTime: "2026-08-25T16:30:01.000Z",
  detections: [{ classId: 0, confidence: 0.91, trackId: "trk-1", bbox: [20, 20, 70, 120] }],
  model: { name: "test", version: "1", checksum: "sha256:test" },
  state
});

assert.equal(first.events.length, 1);
assert.equal(second.events[0].trajectory.length, 2);
assert.equal(validateContract(schema, second.events[0], "TrackEvent").valid, true);

const simulated = buildSimulatedTrackEvents();
const person = simulated.filter((event) => event.objectClass === "PERSON").at(-1);
assert.equal(crossedFence(person.trajectory, {
  line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
  direction: "LEFT_TO_RIGHT"
}), true);

console.log("PASS vision-runtime unit");
