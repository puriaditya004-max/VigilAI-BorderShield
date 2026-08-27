import assert from "node:assert/strict";
import { buildSlaSummary, incidentSlaState, parseSlaPolicy } from "../../services/control-api/src/sla.mjs";

assert.deepEqual(parseSlaPolicy("CRITICAL:3,HIGH:10"), {
  CRITICAL: 3,
  HIGH: 10,
  MEDIUM: 60,
  LOW: 240
});

const now = new Date("2026-08-27T00:20:00.000Z");
const openHigh = {
  incidentId: "inc-open-high",
  severity: "HIGH",
  status: "OPEN",
  receivedAt: "2026-08-27T00:00:00.000Z"
};
const ackCritical = {
  incidentId: "inc-ack-critical",
  severity: "CRITICAL",
  status: "ACKNOWLEDGED",
  receivedAt: "2026-08-27T00:00:00.000Z"
};

const state = incidentSlaState(openHigh, { now });
assert.equal(state.overdue, true);
assert.equal(state.dueAt, "2026-08-27T00:15:00.000Z");

const summary = buildSlaSummary([openHigh, ackCritical], { now });
assert.equal(summary.total, 2);
assert.equal(summary.open, 1);
assert.equal(summary.overdue, 1);

console.log("PASS sla unit");
