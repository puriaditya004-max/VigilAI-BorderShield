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

const ROLE_PERMISSIONS = {
  VIEWER: new Set(["incident:read"]),
  OPERATOR: new Set(["incident:read", "incident:acknowledge"]),
  COMMANDER: new Set(["incident:read", "incident:acknowledge", "incident:escalate"])
};

export function authenticateOperator(req, { requiredPermission } = {}) {
  const operatorId = String(req.headers["x-operator-id"] || "").trim();
  const role = String(req.headers["x-operator-role"] || "VIEWER").trim().toUpperCase();
  const configuredToken = process.env.OPERATOR_TOKEN;

  if (!operatorId) return { ok: false, statusCode: 401, message: "x-operator-id header is required" };
  if (!ROLE_PERMISSIONS[role]) return { ok: false, statusCode: 403, message: "operator role is not allowed" };

  if (configuredToken) {
    const provided = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!constantTimeTextEqual(provided, configuredToken)) {
      return { ok: false, statusCode: 401, message: "operator token mismatch" };
    }
  }

  const permissions = ROLE_PERMISSIONS[role];
  if (requiredPermission && !permissions.has(requiredPermission)) {
    return { ok: false, statusCode: 403, message: "operator permission denied" };
  }

  return { ok: true, operator: { operatorId, role, permissions: [...permissions] } };
}

function constantTimeTextEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
