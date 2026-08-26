import assert from "node:assert/strict";
import { detectCrowdFormation, detectLoitering, detectRepeatedBoundaryApproach, detectSuddenSpeedChange, pointInPolygon } from "../../edge/analytics/src/suspicious-activity.mjs";

const zone = {
  zoneId: "zone-watch",
  polygon: [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 500 },
    { x: 100, y: 500 }
  ],
  line: { a: { x: 500, y: 100 }, b: { x: 500, y: 500 } }
};

const loiterTrack = {
  cameraId: "cam-1",
  trackId: "trk-1",
  trajectory: [
    { x: 200, y: 200, t: "2026-08-26T00:00:00.000Z" },
    { x: 210, y: 205, t: "2026-08-26T00:00:35.000Z" }
  ]
};

assert.equal(pointInPolygon({ x: 200, y: 200 }, zone.polygon), true);
assert.equal(pointInPolygon({ x: 800, y: 200 }, zone.polygon), false);

const loitering = detectLoitering(loiterTrack, zone, { minDwellMs: 30000 });
assert.equal(loitering.detected, true);
assert.deepEqual(loitering.reasonCodes, ["TRACK_INSIDE_ZONE", "DWELL_TIME_EXCEEDED"]);

const approachTrack = {
  cameraId: "cam-1",
  trackId: "trk-2",
  trajectory: [
    { x: 470, y: 140, t: "2026-08-26T00:00:00.000Z" },
    { x: 480, y: 220, t: "2026-08-26T00:00:01.000Z" },
    { x: 472, y: 300, t: "2026-08-26T00:00:02.000Z" }
  ]
};
assert.equal(detectRepeatedBoundaryApproach(approachTrack, zone, { thresholdPx: 35, minApproaches: 3 }).detected, true);

const crowdTracks = [1, 2, 3, 4].map((id) => ({
  cameraId: "cam-1",
  trackId: `trk-${id}`,
  trajectory: [{ x: 150 + id * 10, y: 180, t: "2026-08-26T00:00:00.000Z" }]
}));
assert.equal(detectCrowdFormation(crowdTracks, zone, { minObjects: 4 }).detected, true);

const speedTrack = {
  cameraId: "cam-1",
  trackId: "trk-5",
  trajectory: [
    { x: 0, y: 0, t: "2026-08-26T00:00:00.000Z" },
    { x: 10, y: 0, t: "2026-08-26T00:00:01.000Z" },
    { x: 70, y: 0, t: "2026-08-26T00:00:02.000Z" }
  ]
};
const speed = detectSuddenSpeedChange(speedTrack, { minRatio: 3 });
assert.equal(speed.detected, true);
assert(speed.reasonCodes.includes("CALIBRATION_REQUIRED_FOR_WORLD_SPEED"));

console.log("PASS suspicious-activity unit");
