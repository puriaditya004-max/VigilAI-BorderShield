import fs from "node:fs";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("control-api-read-auth");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
let server;

try {
  seedDb();
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  for (const route of ["/api/incidents", "/api/incidents/sla", "/api/evidence/manifests", "/api/audit", "/api/metrics"]) {
    const missing = await fetch(`${endpoint}${route}`);
    assert(missing.status === 401, `${route} should require operator identity`);

    const viewer = await fetch(`${endpoint}${route}`, {
      headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
    });
    assert(viewer.status === 200, `${route} should allow viewer read permission`);
  }

  const streamMissing = await fetch(`${endpoint}/api/events`);
  assert(streamMissing.status === 401, "/api/events should require operator identity");

  console.log("PASS control-api-read-auth integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

function seedDb() {
  const db = {
    cameras: [],
    zones: [],
    incidents: [{
      schemaVersion: "incident-event.v1",
      eventId: "evt-read-auth",
      incidentId: "inc-read-auth",
      cameraId: "cam-read-auth",
      zoneId: "zone-read-auth",
      type: "VIRTUAL_FENCE_INTRUSION",
      severity: "HIGH",
      reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE"],
      captureTime: "2026-08-27T00:00:00.000Z",
      evidence: { manifestId: "manifest-read-auth", sha256: "a".repeat(64) },
      status: "OPEN"
    }],
    evidence: [],
    audits: [{
      schemaVersion: "audit-event.v1",
      auditId: "aud-read-auth",
      actor: "test",
      action: "incident.created",
      resource: "inc-read-auth",
      createdAt: "2026-08-27T00:00:00.000Z"
    }]
  };
  fs.mkdirSync(ctx.controlDataDir, { recursive: true });
  fs.writeFileSync(ctx.dbPath, `${JSON.stringify(db, null, 2)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
