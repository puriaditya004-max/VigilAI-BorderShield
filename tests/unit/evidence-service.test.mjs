import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanupRuntime, createRuntimeContext } from "../helpers/runtime.mjs";
import { readJson, validateContract } from "../../packages/contracts/src/validate-contract.mjs";

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
  sha256,
  metadata: {
    evidenceMode: "SVG_FIXTURE",
    redactions: [
      {
        targetType: "FACE",
        action: "BLUR",
        method: "BOX_BLUR",
        bbox: { x: 10, y: 10, width: 40, height: 40 },
        confidence: 0.91,
        reasonCodes: ["FACE_PRIVACY_REDACTION_ENABLED"]
      }
    ]
  }
};

assert.equal(verifyEvidenceManifest(manifest).valid, true);
assert.equal(validateContract(readJson("packages/contracts/schemas/evidence-manifest.schema.json"), manifest, "EvidenceManifest").valid, true);

const tampered = structuredClone(manifest);
tampered.assets[0].sha256 = "0".repeat(64);
assert.equal(verifyEvidenceManifest(tampered).valid, false);

cleanupRuntime(ctx);
delete process.env.EVIDENCE_DIR;
console.log("PASS evidence-service unit");
