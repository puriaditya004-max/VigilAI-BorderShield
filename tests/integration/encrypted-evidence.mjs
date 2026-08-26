import fs from "node:fs";
import { createTextEvidence } from "../../edge/analytics/src/evidence.mjs";
import { decryptEvidenceBuffer } from "../../services/evidence-service/src/encryption.mjs";
import { verifyEvidenceManifest } from "../../services/evidence-service/src/manifest.mjs";
import { cleanupRuntime, createRuntimeContext, listFiles } from "../helpers/runtime.mjs";

const ctx = createRuntimeContext("encrypted-evidence");
process.env.EVIDENCE_DIR = ctx.evidenceDir;
process.env.EVIDENCE_ENCRYPTION_KEY = "integration-test-key";

try {
  const manifest = createTextEvidence({
    incidentHint: "inc-encrypted-evidence",
    zone: {
      zoneId: "zone-east-fence",
      line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } }
    },
    trackEvent: {
      cameraId: "cam-1",
      trackId: "trk-1",
      objectClass: "PERSON",
      confidence: 0.91,
      captureTime: "2026-08-26T00:00:00.000Z",
      bbox: { x: 600, y: 220, width: 80, height: 180 },
      trajectory: [
        { x: 620, y: 300 },
        { x: 660, y: 320 }
      ]
    }
  });

  const files = listFiles(ctx.evidenceDir, ".enc");
  assert(files.length === 1, "expected encrypted evidence artifact");
  assert(manifest.keyframeUri.endsWith(".enc"), "manifest should reference encrypted file");
  assert(verifyEvidenceManifest(contractManifest(manifest)).valid, "encrypted artifact hash should verify");

  const decrypted = decryptEvidenceBuffer(fs.readFileSync(files[0]), process.env.EVIDENCE_ENCRYPTION_KEY);
  assert(decrypted.toString("utf8").includes("VigilAI BorderShield Evidence"), "decrypted evidence should contain SVG");

  console.log("PASS encrypted-evidence integration");
} finally {
  delete process.env.EVIDENCE_ENCRYPTION_KEY;
  cleanupRuntime(ctx);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function contractManifest(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    manifestId: manifest.manifestId,
    incidentId: manifest.incidentId,
    createdAt: manifest.createdAt,
    assets: manifest.assets,
    sha256: manifest.sha256
  };
}
