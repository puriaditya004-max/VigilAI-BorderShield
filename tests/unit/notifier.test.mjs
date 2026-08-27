import assert from "node:assert/strict";
import { notifyIncidentEvent, shouldNotifyIncident } from "../../services/control-api/src/notifier.mjs";

const incident = {
  incidentId: "inc-notifier-unit",
  eventId: "evt-notifier-unit",
  cameraId: "cam-1",
  zoneId: "zone-1",
  type: "VIRTUAL_FENCE_INTRUSION",
  severity: "HIGH",
  status: "OPEN",
  captureTime: "2026-08-27T00:00:00.000Z",
  evidence: { manifestId: "manifest-notifier-unit", sha256: "a".repeat(64) },
  reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE"]
};

assert.equal(shouldNotifyIncident(incident, { webhookUrl: "", minSeverity: "HIGH" }), false);
assert.equal(shouldNotifyIncident(incident, { webhookUrl: "http://localhost/alert", minSeverity: "CRITICAL" }), false);
assert.equal(shouldNotifyIncident(incident, { webhookUrl: "http://localhost/alert", minSeverity: "HIGH" }), true);

const skipped = await notifyIncidentEvent({ eventName: "incident.created", incident, webhookUrl: "" });
assert.equal(skipped.skipped, true);

const invalid = await notifyIncidentEvent({ eventName: "incident.created", incident, webhookUrl: "ftp://localhost/alert" });
assert.equal(invalid.delivered, false);
assert.match(invalid.error, /http or https/);

console.log("PASS notifier unit");
