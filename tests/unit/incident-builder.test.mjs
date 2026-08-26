import assert from "node:assert/strict";
import { buildAnalyticsIncident } from "../../edge/analytics/src/incident-builder.mjs";
import { readJson, validateContract } from "../../packages/contracts/src/validate-contract.mjs";

const schema = readJson("packages/contracts/schemas/incident-event.schema.json");
const evidence = {
  manifestId: "manifest-analytics-test",
  sha256: "b".repeat(64),
  keyframeUri: "evidence://keyframe.svg",
  clipUri: "evidence://clip.txt"
};

const night = buildAnalyticsIncident({
  cameraId: "cam-1",
  zoneId: "zone-night",
  trackId: "trk-1",
  evidence,
  captureTime: "2026-08-26T00:00:00.000Z",
  decision: {
    type: "NIGHT_MOVEMENT",
    severity: "HIGH",
    reasonCodes: ["LOW_LIGHT_CONFIRMED", "TRACK_PRESENT_IN_MONITORED_ZONE"]
  }
});
assert.equal(night.type, "NIGHT_MOVEMENT");
assert.equal(validateContract(schema, night, "IncidentEvent").valid, true);

const suspicious = buildAnalyticsIncident({
  cameraId: "cam-1",
  zoneId: "zone-watch",
  trackId: "trk-2",
  evidence,
  captureTime: "2026-08-26T00:00:01.000Z",
  decision: {
    type: "LOITERING",
    severity: "MEDIUM",
    reasonCodes: ["TRACK_INSIDE_ZONE", "DWELL_TIME_EXCEEDED"]
  }
});
assert.equal(suspicious.type, "SUSPICIOUS_ACTIVITY");
assert.equal(validateContract(schema, suspicious, "IncidentEvent").valid, true);

console.log("PASS incident-builder unit");
