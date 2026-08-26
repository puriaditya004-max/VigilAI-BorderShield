import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function hasEvidenceEncryptionKey(env = process.env) {
  return Boolean(env.EVIDENCE_ENCRYPTION_KEY);
}

export function encryptEvidenceBuffer(buffer, keyMaterial = process.env.EVIDENCE_ENCRYPTION_KEY) {
  const key = deriveKey(keyMaterial);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from("VIGE1"), iv, tag, ciphertext]);
}

export function decryptEvidenceBuffer(payload, keyMaterial = process.env.EVIDENCE_ENCRYPTION_KEY) {
  const magic = payload.subarray(0, 5).toString("utf8");
  if (magic !== "VIGE1") throw new Error("unsupported evidence encryption format");

  const key = deriveKey(keyMaterial);
  const iv = payload.subarray(5, 5 + IV_BYTES);
  const tag = payload.subarray(5 + IV_BYTES, 5 + IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(5 + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function deriveKey(keyMaterial) {
  if (!keyMaterial) throw new Error("EVIDENCE_ENCRYPTION_KEY is required for encrypted evidence");

  if (keyMaterial.startsWith("base64:")) {
    const decoded = Buffer.from(keyMaterial.slice("base64:".length), "base64");
    if (decoded.length === 32) return decoded;
  }

  if (/^[a-f0-9]{64}$/i.test(keyMaterial)) return Buffer.from(keyMaterial, "hex");

  return crypto.createHash("sha256").update(keyMaterial).digest();
}
