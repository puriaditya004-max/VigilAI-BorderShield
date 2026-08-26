import fs from "node:fs";
import path from "node:path";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("evidence-retention-api");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const oldPath = path.join(ctx.evidenceDir, "old.svg");
const newPath = path.join(ctx.evidenceDir, "new.svg");

let server;
try {
  fs.mkdirSync(ctx.evidenceDir, { recursive: true });
  fs.writeFileSync(oldPath, "old");
  fs.writeFileSync(newPath, "new");
  seedDb();

  server = await startControlApi({ cwd: root, port, env: ctx.env });
  const result = await postJson("/api/evidence/retention/run", {
    now: "2026-08-26T00:00:00.000Z",
    retentionDays: 14
  }, {
    "x-operator-id": "commander-1",
    "x-operator-role": "COMMANDER"
  });

  assert(result.expired.length === 1, "expected one expired manifest");
  assert(result.summary.expired === 1, "summary should count expired manifest");
  assert(!fs.existsSync(oldPath), "old evidence file should be deleted");
  assert(fs.existsSync(newPath), "new evidence file should remain");

  const audit = await fetchJson("/api/audit");
  assert(audit.some((event) => event.action === "evidence.retention_run"), "retention audit missing");

  console.log("PASS evidence-retention-api integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

function seedDb() {
  const db = {
    cameras: [],
    zones: [],
    incidents: [],
    audits: [],
    evidence: [
      evidenceManifest("manifest-old-retention", "2026-07-01T00:00:00.000Z", oldPath),
      evidenceManifest("manifest-new-retention", "2026-08-25T00:00:00.000Z", newPath)
    ]
  };
  fs.mkdirSync(ctx.controlDataDir, { recursive: true });
  fs.writeFileSync(ctx.dbPath, `${JSON.stringify(db, null, 2)}\n`);
}

function evidenceManifest(manifestId, createdAt, filePath) {
  return {
    schemaVersion: "evidence-manifest.v1",
    manifestId,
    incidentId: `inc-${manifestId}`,
    createdAt,
    assets: [{ kind: "KEYFRAME", uri: `file://${filePath.replaceAll("\\", "/")}`, sha256: "e".repeat(64) }],
    sha256: "f".repeat(64),
    status: "VERIFIED"
  };
}

async function postJson(route, body, headers) {
  const response = await fetch(`${endpoint}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

async function fetchJson(route) {
  const response = await fetch(`${endpoint}${route}`);
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
