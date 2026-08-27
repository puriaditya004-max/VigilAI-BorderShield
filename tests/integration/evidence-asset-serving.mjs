import crypto from "node:crypto";
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
const ctx = createRuntimeContext("evidence-asset-serving");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const assetPath = path.join(ctx.evidenceDir, "verified-keyframe.png");
const outsidePath = path.join(ctx.root, "outside-keyframe.png");
let server;

try {
  fs.mkdirSync(ctx.evidenceDir, { recursive: true });
  fs.writeFileSync(assetPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  fs.writeFileSync(outsidePath, Buffer.from("outside evidence root"));
  seedDb();

  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const unauthenticated = await fetch(`${endpoint}/api/evidence/assets/manifest-asset-serving/0`);
  assert(unauthenticated.status === 401, "evidence asset endpoint should require operator auth");

  const manifests = await fetchJson("/api/evidence/manifests");
  const publicManifest = manifests.find((item) => item.manifestId === "manifest-asset-serving");
  assert(publicManifest.assets[0].assetUrl === "/api/evidence/assets/manifest-asset-serving/0", "manifest list should expose a safe asset URL");
  assert(!JSON.stringify(publicManifest).includes("file://"), "manifest list should not expose raw filesystem URIs");

  const served = await fetch(`${endpoint}/api/evidence/assets/manifest-asset-serving/0`, {
    headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
  });
  assert(served.status === 200, "viewer should read verified evidence asset");
  assert(served.headers.get("content-type") === "image/png", "asset content type should be preserved");
  assert(Buffer.compare(Buffer.from(await served.arrayBuffer()), fs.readFileSync(assetPath)) === 0, "served asset bytes should match stored file");

  const outside = await fetch(`${endpoint}/api/evidence/assets/manifest-outside-root/0`, {
    headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
  });
  assert(outside.status === 403, "asset outside configured evidence dir should not be served");

  const expired = await fetch(`${endpoint}/api/evidence/assets/manifest-expired/0`, {
    headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
  });
  assert(expired.status === 404, "expired evidence should not expose assets");

  console.log("PASS evidence-asset-serving integration");
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
      evidenceManifest("manifest-asset-serving", assetPath, "VERIFIED"),
      evidenceManifest("manifest-outside-root", outsidePath, "VERIFIED"),
      evidenceManifest("manifest-expired", assetPath, "EXPIRED")
    ]
  };
  fs.mkdirSync(ctx.controlDataDir, { recursive: true });
  fs.writeFileSync(ctx.dbPath, `${JSON.stringify(db, null, 2)}\n`);
}

function evidenceManifest(manifestId, filePath, status) {
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return {
    schemaVersion: "evidence-manifest.v1",
    manifestId,
    incidentId: `inc-${manifestId}`,
    createdAt: "2026-08-27T00:00:00.000Z",
    assets: [{
      kind: "KEYFRAME",
      uri: `file://${filePath.replaceAll("\\", "/")}`,
      sha256,
      contentType: "image/png"
    }],
    sha256,
    status
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(route) {
  const response = await fetch(`${endpoint}${route}`, {
    headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}
