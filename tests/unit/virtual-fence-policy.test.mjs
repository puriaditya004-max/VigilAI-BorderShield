import assert from "node:assert/strict";
import {
  buildIntrusionIncident,
  evaluateFenceIntrusion,
  FenceIncidentPolicy,
  isZoneActive,
  objectClassAllowed
} from "../../edge/analytics/src/virtual-fence.mjs";

const trackEvent = {
  schemaVersion: "track-event.v1",
  eventId: "evt-track-policy-001",
  cameraId: "cam-bop-01-east",
  trackId: "trk-person-001",
  objectClass: "PERSON",
  confidence: 0.9,
  captureTime: "2026-08-26T00:00:05.000Z",
  trajectory: [
    { x: 620, y: 120, t: "2026-08-26T00:00:00.000Z" },
    { x: 660, y: 140, t: "2026-08-26T00:00:05.000Z" }
  ],
  model: { name: "fixture", version: "1", checksum: "sha256:test" }
};

const zone = {
  zoneId: "zone-east-fence",
  cameraId: "cam-bop-01-east",
  line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
  direction: "LEFT_TO_RIGHT",
  objectClasses: ["PERSON"],
  minTrajectoryPoints: 2,
  cooldownMs: 10000,
  schedule: { utcDays: [3], utcStartHour: 0, utcEndHour: 2 }
};

assert.equal(objectClassAllowed(trackEvent, zone), true);
assert.equal(objectClassAllowed({ ...trackEvent, objectClass: "VEHICLE" }, zone), false);
assert.equal(isZoneActive(zone, new Date("2026-08-26T01:00:00.000Z")), true);
assert.equal(isZoneActive(zone, new Date("2026-08-26T03:00:00.000Z")), false);

const allowed = evaluateFenceIntrusion({ trackEvent, zone, evaluatedAt: new Date("2026-08-26T01:00:00.000Z") });
assert.equal(allowed.allowed, true);
assert.deepEqual(allowed.reasonCodes, ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED", "ZONE_POLICY_MATCHED"]);

const blockedByClass = evaluateFenceIntrusion({
  trackEvent: { ...trackEvent, objectClass: "VEHICLE" },
  zone,
  evaluatedAt: new Date("2026-08-26T01:00:00.000Z")
});
assert.equal(blockedByClass.allowed, false);
assert.deepEqual(blockedByClass.reasonCodes, ["OBJECT_CLASS_NOT_MONITORED"]);

let now = new Date("2026-08-26T01:00:00.000Z");
const policy = new FenceIncidentPolicy({ now: () => now });
assert.equal(policy.evaluate({ trackEvent, zone }).allowed, true);
now = new Date("2026-08-26T01:00:03.000Z");
const duplicate = policy.evaluate({ trackEvent, zone });
assert.equal(duplicate.allowed, false);
assert.deepEqual(duplicate.reasonCodes, ["DUPLICATE_COOLDOWN_ACTIVE"]);

const incident = buildIntrusionIncident({
  trackEvent,
  zone,
  evidence: {
    manifestId: "manifest-policy-test",
    sha256: "a".repeat(64),
    keyframeUri: "evidence://keyframe.svg",
    clipUri: "evidence://clip.txt"
  },
  decision: allowed
});
assert(incident.reasonCodes.includes("ZONE_POLICY_MATCHED"));

console.log("PASS virtual-fence-policy unit");
