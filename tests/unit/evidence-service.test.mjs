import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanupRuntime, createRuntimeContext } from "../helpers/runtime.mjs";
import { createMp4ClipEvidence, createPngEvidence } from "../../edge/analytics/src/evidence.mjs";
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

const pngManifest = createPngEvidence({
  incidentHint: "inc-png-evidence",
  trackEvent: {
    cameraId: "cam-bop-01-east",
    trackId: "trk-png",
    objectClass: "PERSON",
    confidence: 0.92,
    bbox: { x: 4, y: 4, width: 8, height: 8 },
    trajectory: [
      { x: 4, y: 12, t: "2026-08-26T00:00:00.000Z" },
      { x: 12, y: 12, t: "2026-08-26T00:00:01.000Z" }
    ],
    captureTime: "2026-08-26T00:00:01.000Z"
  },
  zone: {
    zoneId: "zone-png",
    line: { a: { x: 10, y: 0 }, b: { x: 10, y: 16 } }
  },
  frame: {
    width: 16,
    height: 16
  },
  privacyPlan: {
    targets: [
      {
        targetType: "FACE",
        action: "BLUR",
        method: "GAUSSIAN_BLUR",
        bbox: { x: 5, y: 5, width: 4, height: 4 },
        confidence: 0.9,
        reasonCodes: ["FACE_PRIVACY_REDACTION_ENABLED"]
      }
    ]
  }
});
const pngAssetPath = pngManifest.assets[0].uri.replace("file://", "");
const pngBytes = fs.readFileSync(pngAssetPath);
assert.deepEqual([...pngBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(pngManifest.assets[0].contentType, "image/png");
assert.equal(pngManifest.metadata.evidenceMode, "PNG_KEYFRAME");
assert.equal(pngManifest.metadata.redactions.length, 1);
assert.equal(verifyEvidenceManifest(pngManifest).valid, true);
assert.equal(validateContract(readJson("packages/contracts/schemas/evidence-manifest.schema.json"), pngManifest, "EvidenceManifest").valid, true);

const clipManifest = await createMp4ClipEvidence({
  incidentHint: "inc-mp4-evidence",
  trackEvent: {
    cameraId: "cam-bop-01-east",
    trackId: "trk-clip",
    captureTime: "2026-08-26T00:00:02.000Z"
  },
  frames: [
    { uri: pngManifest.keyframeUri, captureTime: "2026-08-26T00:00:01.000Z" },
    { uri: pngManifest.keyframeUri, captureTime: "2026-08-26T00:00:02.000Z" }
  ],
  fps: 2,
  runClip: async ({ args }) => {
    fs.writeFileSync(args.at(-1), Buffer.from("000000206674797069736f6d0000020069736f6d69736f32617663316d703431", "hex"));
    return { ok: true, code: 0 };
  }
});
const clipPath = clipManifest.clipUri.replace("file://", "");
assert.equal(fs.existsSync(clipPath), true);
assert.equal(clipManifest.assets[0].kind, "CLIP");
assert.equal(clipManifest.assets[0].contentType, "video/mp4");
assert.equal(clipManifest.metadata.evidenceMode, "MP4_CLIP");
assert.equal(clipManifest.metadata.frameCount, 2);
assert.equal(verifyEvidenceManifest(clipManifest).valid, true);
assert.equal(validateContract(readJson("packages/contracts/schemas/evidence-manifest.schema.json"), clipManifest, "EvidenceManifest").valid, true);

cleanupRuntime(ctx);
delete process.env.EVIDENCE_DIR;
console.log("PASS evidence-service unit");
