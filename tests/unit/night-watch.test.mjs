import assert from "node:assert/strict";
import { assessLowLightQuality, detectFrameTamper, detectNightMovement } from "../../edge/analytics/src/night-watch.mjs";

const zone = {
  zoneId: "zone-night",
  polygon: [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 300 },
    { x: 0, y: 300 }
  ]
};

const trackEvent = {
  cameraId: "cam-1",
  trackId: "trk-1",
  trajectory: [
    { x: 100, y: 120, t: "2026-08-26T00:00:00.000Z" },
    { x: 140, y: 160, t: "2026-08-26T00:00:05.000Z" }
  ]
};

const lowLight = assessLowLightQuality({ brightness: 0.08, contrast: 0.05 });
assert.equal(lowLight.lowLight, true);
assert(lowLight.reasonCodes.includes("BRIGHTNESS_BELOW_THRESHOLD"));

const movement = detectNightMovement(trackEvent, zone, { brightness: 0.08, contrast: 0.05 });
assert.equal(movement.detected, true);
assert.deepEqual(movement.reasonCodes, ["LOW_LIGHT_CONFIRMED", "TRACK_PRESENT_IN_MONITORED_ZONE"]);

const daylight = detectNightMovement(trackEvent, zone, { brightness: 0.6, contrast: 0.4 });
assert.equal(daylight.detected, false);
assert.deepEqual(daylight.reasonCodes, ["LIGHT_LEVEL_ACCEPTABLE"]);

const tamper = detectFrameTamper({
  cameraId: "cam-1",
  brightness: 0.02,
  contrast: 0.01,
  sharpness: 0.02,
  blockedRatio: 0.82
});
assert.equal(tamper.detected, true);
assert(tamper.reasonCodes.includes("FRAME_OCCLUSION_THRESHOLD_EXCEEDED"));
assert(tamper.reasonCodes.includes("FRAME_BLACKOUT_SUSPECTED"));

const healthy = detectFrameTamper({ cameraId: "cam-1", brightness: 0.5, contrast: 0.2, sharpness: 0.4, blockedRatio: 0.1 });
assert.equal(healthy.detected, false);

console.log("PASS night-watch unit");
