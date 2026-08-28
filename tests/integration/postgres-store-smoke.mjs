import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { runMigrations } from "../../services/control-api/src/run-migrations.mjs";
import { createPostgresTestContext } from "../helpers/postgres.mjs";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const pg = await createPostgresTestContext("store_smoke");
if (pg.skipped) {
  console.log(`SKIP postgres-store-smoke integration: ${pg.reason}`);
  process.exit(0);
}

const runtime = createRuntimeContext("postgres-store-smoke");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
let api;

try {
  await runMigrations({ connectionString: pg.connectionString });
  api = await startControlApi({
    cwd: process.cwd(),
    port,
    env: {
      ...runtime.env,
      STORE_DRIVER: "postgres",
      POSTGRES_URL: pg.connectionString
    }
  });

  const camera = await registerCamera(endpoint);
  await createIncident(endpoint, camera.deviceKey);
  await createEvidence(endpoint, camera.deviceKey, runtime.evidenceDir);

  process.env.POSTGRES_URL = pg.connectionString;
  const dbModule = await import(`../../services/control-api/src/store-postgres.mjs?smoke=${Date.now()}`);
  const db = await dbModule.readDb();

  assert(db.cameras.length === 1, "postgres store should persist one camera");
  assert(db.incidents.length === 1, "postgres store should persist one incident");
  assert(db.evidence.length === 1, "postgres store should persist one evidence manifest");
  assert(db.evidence[0].assets.length === 1, "postgres store should round-trip evidence assets");
  assert(db.audits.some((event) => event.action === "incident.created"), "postgres store should persist incident audit");

  console.log("PASS postgres-store-smoke integration");
} finally {
  await stopProcess(api);
  await pg.cleanup();
  cleanupRuntime(runtime);
}

async function registerCamera(endpoint) {
  const response = await fetch(`${endpoint}/api/cameras/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "pg-register" },
    body: JSON.stringify({
      cameraId: "cam-pg-01",
      name: "Postgres smoke camera",
      edgeNodeId: "edge-pg-01",
      location: "test"
    })
  });
  assert(response.ok, `camera registration failed: ${response.status}`);
  return response.json();
}

async function createIncident(endpoint, deviceKey) {
  const response = await fetch(`${endpoint}/api/incidents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey,
      "idempotency-key": "pg-incident"
    },
    body: JSON.stringify({
      schemaVersion: "incident-event.v1",
      eventId: "evt-pg-smoke",
      incidentId: "inc-pg-smoke",
      cameraId: "cam-pg-01",
      zoneId: "zone-east-fence",
      type: "VIRTUAL_FENCE_INTRUSION",
      severity: "HIGH",
      reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE"],
      captureTime: "2026-08-28T00:00:00.000Z",
      evidence: { manifestId: "manifest-pg-smoke", sha256: "a".repeat(64) }
    })
  });
  assert(response.status === 201, `incident creation failed: ${response.status}`);
}

async function createEvidence(endpoint, deviceKey, evidenceDir) {
  const evidencePath = path.join(evidenceDir, "pg-smoke.txt");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const evidencePayload = "postgres evidence smoke\n";
  fs.writeFileSync(evidencePath, evidencePayload);
  const sha256 = crypto.createHash("sha256").update(evidencePayload).digest("hex");

  const response = await fetch(`${endpoint}/api/evidence/manifests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey,
      "x-camera-id": "cam-pg-01",
      "idempotency-key": "pg-evidence"
    },
    body: JSON.stringify({
      schemaVersion: "evidence-manifest.v1",
      manifestId: "manifest-pg-smoke",
      incidentId: "inc-pg-smoke",
      createdAt: "2026-08-28T00:00:01.000Z",
      assets: [{ kind: "KEYFRAME", uri: `file://${evidencePath.replaceAll("\\", "/")}`, sha256 }],
      sha256
    })
  });
  assert(response.status === 201, `evidence creation failed: ${response.status}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
