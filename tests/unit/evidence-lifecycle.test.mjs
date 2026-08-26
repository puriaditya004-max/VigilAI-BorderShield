import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptEvidenceBuffer, decryptEvidenceBuffer } from "../../services/evidence-service/src/encryption.mjs";
import { buildRetentionSummary, expireEvidenceManifests } from "../../services/evidence-service/src/retention.mjs";

const encrypted = encryptEvidenceBuffer(Buffer.from("classified keyframe"), "test-key");
assert.notEqual(encrypted.toString("utf8"), "classified keyframe");
assert.equal(decryptEvidenceBuffer(encrypted, "test-key").toString("utf8"), "classified keyframe");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-lifecycle-"));
try {
  const expiredPath = path.join(root, "old.svg.enc");
  const retainedPath = path.join(root, "new.svg.enc");
  fs.writeFileSync(expiredPath, "old");
  fs.writeFileSync(retainedPath, "new");

  const db = {
    evidence: [
      manifest("old-manifest", "2026-07-01T00:00:00.000Z", expiredPath),
      manifest("new-manifest", "2026-08-25T00:00:00.000Z", retainedPath)
    ]
  };

  const result = expireEvidenceManifests(db, {
    now: new Date("2026-08-26T00:00:00.000Z"),
    retentionDays: 14
  });

  assert.deepEqual(result.expired, ["old-manifest"]);
  assert.equal(fs.existsSync(expiredPath), false);
  assert.equal(fs.existsSync(retainedPath), true);
  assert.deepEqual(buildRetentionSummary(db), { total: 2, verified: 1, expired: 1 });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS evidence-lifecycle unit");

function manifest(manifestId, createdAt, filePath) {
  return {
    manifestId,
    createdAt,
    status: "VERIFIED",
    assets: [{ uri: `file://${filePath.replaceAll("\\", "/")}` }]
  };
}
