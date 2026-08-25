import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanupRuntime, createRuntimeContext } from "../helpers/runtime.mjs";

const ctx = createRuntimeContext("evidence-unit");
process.env.EVIDENCE_DIR = ctx.evidenceDir;
const { hashFile, verifyEvidenceManifest } = await import("../../services/evidence-service/src/manifest.mjs");

fs.mkdirSync(ctx.evidenceDir, { recursive: true });

const assetPath = path.join(ctx.evidenceDir, "unit-evidence.txt");
fs.writeFileSync(assetPath, "verified evidence asset");
const sha256 = hashFile(assetPath);

const manifest = {
  schemaVersion: "evidence-manifest.v1",
  manifestId: "manifest-unit-0001",
  incidentId: "incident-unit-0001",
  createdAt: new Date().toISOString(),
  assets: [
    {
      kind: "KEYFRAME",
      uri: `file://${assetPath.replaceAll("\\", "/")}`,
      sha256
    }
  ],
  sha256
};

assert.equal(verifyEvidenceManifest(manifest).valid, true);

const tampered = structuredClone(manifest);
tampered.assets[0].sha256 = "0".repeat(64);
assert.equal(verifyEvidenceManifest(tampered).valid, false);

cleanupRuntime(ctx);
delete process.env.EVIDENCE_DIR;
console.log("PASS evidence-service unit");
