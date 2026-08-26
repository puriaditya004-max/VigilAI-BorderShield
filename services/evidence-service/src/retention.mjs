import fs from "node:fs";

export function expireEvidenceManifests(db, {
  now = new Date(),
  retentionDays = Number(process.env.EVIDENCE_RETENTION_DAYS || 30),
  deleteLocalFiles = process.env.EVIDENCE_RETENTION_DELETE_FILES !== "false"
} = {}) {
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const expired = [];
  const deletedFiles = [];

  for (const manifest of db.evidence) {
    if (manifest.status === "EXPIRED") continue;
    if (Date.parse(manifest.createdAt) > cutoffMs) continue;

    manifest.status = "EXPIRED";
    manifest.expiredAt = now.toISOString();
    expired.push(manifest.manifestId);

    if (!deleteLocalFiles) continue;
    for (const asset of manifest.assets || []) {
      const filePath = filePathFromUri(asset.uri);
      if (!filePath || !fs.existsSync(filePath)) continue;
      fs.unlinkSync(filePath);
      deletedFiles.push(filePath);
    }
  }

  return { expired, deletedFiles };
}

export function buildRetentionSummary(db) {
  return {
    total: db.evidence.length,
    verified: db.evidence.filter((item) => item.status === "VERIFIED").length,
    expired: db.evidence.filter((item) => item.status === "EXPIRED").length
  };
}

function filePathFromUri(uri) {
  if (!String(uri || "").startsWith("file://")) return null;
  return decodeURIComponent(String(uri).replace("file://", ""));
}
