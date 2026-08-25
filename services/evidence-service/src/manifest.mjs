import crypto from "node:crypto";
import fs from "node:fs";
import { validateContract, readJson } from "../../../packages/contracts/src/validate-contract.mjs";

const schema = readJson("packages/contracts/schemas/evidence-manifest.schema.json");

export function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function hashFile(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}

export function verifyEvidenceManifest(manifest) {
  const contract = validateContract(schema, manifest, "EvidenceManifest");
  if (!contract.valid) return { valid: false, errors: contract.errors };

  const errors = [];
  for (const asset of manifest.assets) {
    if (!asset.uri.startsWith("file://")) continue;
    const filePath = decodeURIComponent(asset.uri.replace("file://", ""));
    if (!fs.existsSync(filePath)) {
      errors.push(`asset missing: ${asset.uri}`);
      continue;
    }
    const actual = hashFile(filePath);
    if (actual !== asset.sha256) errors.push(`asset hash mismatch: ${asset.uri}`);
  }

  return { valid: errors.length === 0, errors };
}

export function buildManifestDigest(manifest) {
  const stable = {
    schemaVersion: manifest.schemaVersion,
    manifestId: manifest.manifestId,
    incidentId: manifest.incidentId,
    createdAt: manifest.createdAt,
    assets: manifest.assets
  };
  return hashBuffer(Buffer.from(JSON.stringify(stable)));
}
