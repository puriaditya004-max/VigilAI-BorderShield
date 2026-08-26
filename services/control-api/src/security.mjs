import crypto from "node:crypto";

export function issueDeviceKey() {
  return `dev_${crypto.randomBytes(24).toString("hex")}`;
}

export function hashDeviceKey(deviceKey, salt = process.env.DEVICE_KEY_SALT || "dev-only-change-me") {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${deviceKey}`)
    .digest("hex");
}

export function verifyDeviceKey({ providedKey, storedHash, legacyPlaintextKey }) {
  if (!providedKey) return false;
  if (storedHash) {
    const expected = Buffer.from(storedHash, "hex");
    const actual = Buffer.from(hashDeviceKey(providedKey), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  return legacyPlaintextKey === providedKey;
}

export function publicCamera(camera) {
  const { deviceKey, deviceKeyHash, ...safeCamera } = camera;
  return safeCamera;
}

export function publicCameraWithIssuedKey(camera, deviceKey) {
  return { ...publicCamera(camera), deviceKey };
}

export function createRateLimiter({ windowMs = 60000, maxRequests = 240 } = {}) {
  const buckets = new Map();

  return {
    check(key, now = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        const next = { count: 1, resetAt: now + windowMs };
        buckets.set(key, next);
        return { allowed: true, remaining: maxRequests - 1, resetAt: next.resetAt };
      }

      bucket.count += 1;
      return {
        allowed: bucket.count <= maxRequests,
        remaining: Math.max(0, maxRequests - bucket.count),
        resetAt: bucket.resetAt
      };
    },
    reset() {
      buckets.clear();
    }
  };
}

export function clientRateLimitKey(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || req.socket?.remoteAddress || "unknown-client";
}
