import fs from "node:fs";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("incident-sla");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
let server;

try {
  seedDb();
  server = await startControlApi({
    cwd: root,
    port,
    env: { ...ctx.env, INCIDENT_SLA_MINUTES: "CRITICAL:5,HIGH:15,MEDIUM:60,LOW:240" }
  });

  const sla = await fetchJson("/api/incidents/sla");
  assert(sla.overdue === 1, "one open high incident should be overdue");
  assert(sla.incidents.some((item) => item.incidentId === "inc-sla-open" && item.overdue), "open incident SLA state missing");

  const metrics = await fetchJson("/api/metrics");
  assert(metrics.incidents.sla.overdue === 1, "metrics should include SLA overdue count");

  console.log("PASS incident-sla integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

function seedDb() {
  const db = {
    cameras: [],
    zones: [],
    incidents: [
      incident("inc-sla-open", "HIGH", "OPEN"),
      incident("inc-sla-ack", "CRITICAL", "ACKNOWLEDGED")
    ],
    evidence: [],
    audits: []
  };
  fs.mkdirSync(ctx.controlDataDir, { recursive: true });
  fs.writeFileSync(ctx.dbPath, `${JSON.stringify(db, null, 2)}\n`);
}

function incident(incidentId, severity, status) {
  return {
    schemaVersion: "incident-event.v1",
    eventId: `evt-${incidentId}`,
    incidentId,
    cameraId: "cam-sla",
    zoneId: "zone-sla",
    type: "VIRTUAL_FENCE_INTRUSION",
    severity,
    reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE"],
    captureTime: "2026-08-26T00:00:00.000Z",
    receivedAt: "2026-08-26T00:00:00.000Z",
    evidence: { manifestId: `manifest-${incidentId}`, sha256: "a".repeat(64) },
    status
  };
}

async function fetchJson(route) {
  const response = await fetch(`${endpoint}${route}`, {
    headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
