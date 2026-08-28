import crypto from "node:crypto";

const ROLE_PERMISSIONS = {
  VIEWER: new Set(["incident:read"]),
  OPERATOR: new Set(["incident:read", "incident:acknowledge"]),
  COMMANDER: new Set(["incident:read", "incident:acknowledge", "incident:escalate"])
};

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

export async function authenticateOperator(req, { requiredPermission } = {}) {
  if (operatorAuthMode() === "jwt") {
    return authenticateJwtOperator(req, { requiredPermission });
  }
  return authenticateHeaderOperator(req, { requiredPermission });
}

export async function loginOperator({ username, password }) {
  const user = configuredOperators().find((item) => item.username === username);
  if (!user) return { ok: false, statusCode: 401, message: "invalid operator credentials" };

  const passwordOk = await verifyOperatorPassword({ password, passwordHash: user.passwordHash });
  if (!passwordOk.ok) return passwordOk;

  const operator = normalizeOperator(user);
  const token = signJwt({
    sub: operator.operatorId,
    username: user.username,
    role: operator.role
  }, {
    expiresInSeconds: Number(process.env.OPERATOR_JWT_TTL_SECONDS || 8 * 60 * 60)
  });

  return {
    ok: true,
    token,
    operator: {
      operatorId: operator.operatorId,
      username: user.username,
      role: operator.role,
      permissions: [...operator.permissions]
    }
  };
}

export function operatorAuthMode() {
  return String(process.env.OPERATOR_AUTH_MODE || "headers").toLowerCase();
}

function authenticateHeaderOperator(req, { requiredPermission } = {}) {
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

function authenticateJwtOperator(req, { requiredPermission } = {}) {
  const provided = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!provided) return { ok: false, statusCode: 401, message: "operator bearer token is required" };

  const verified = verifyJwt(provided);
  if (!verified.ok) return verified;

  const operatorId = String(verified.payload.sub || "").trim();
  const role = String(verified.payload.role || "VIEWER").trim().toUpperCase();
  if (!operatorId) return { ok: false, statusCode: 401, message: "operator token subject is required" };
  if (!ROLE_PERMISSIONS[role]) return { ok: false, statusCode: 403, message: "operator role is not allowed" };

  const permissions = ROLE_PERMISSIONS[role];
  if (requiredPermission && !permissions.has(requiredPermission)) {
    return { ok: false, statusCode: 403, message: "operator permission denied" };
  }

  return { ok: true, operator: { operatorId, role, permissions: [...permissions] } };
}

function configuredOperators() {
  const raw = process.env.OPERATOR_USERS_JSON;
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("OPERATOR_USERS_JSON must be a JSON array");
  return parsed;
}

function normalizeOperator(user) {
  const role = String(user.role || "VIEWER").trim().toUpperCase();
  if (!ROLE_PERMISSIONS[role]) throw new Error(`operator ${user.username} has unsupported role ${role}`);
  return {
    operatorId: String(user.operatorId || user.username).trim(),
    role,
    permissions: ROLE_PERMISSIONS[role]
  };
}

async function verifyOperatorPassword({ password, passwordHash }) {
  if (!password || !passwordHash) return { ok: false, statusCode: 401, message: "invalid operator credentials" };
  if (!String(passwordHash).startsWith("$argon2")) {
    return { ok: false, statusCode: 500, message: "operator password hash must use Argon2 PHC format" };
  }

  let argon2;
  try {
    argon2 = await import("argon2");
  } catch {
    return { ok: false, statusCode: 503, message: "argon2 package is required for OPERATOR_AUTH_MODE=jwt" };
  }

  const verified = await argon2.default.verify(passwordHash, password);
  return verified
    ? { ok: true }
    : { ok: false, statusCode: 401, message: "invalid operator credentials" };
}

function signJwt(payload, { expiresInSeconds }) {
  const secret = operatorJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };
  const encodedHeader = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const encodedPayload = base64UrlJson(body);
  const signature = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token) {
  const secret = operatorJwtSecret();
  const parts = String(token).split(".");
  if (parts.length !== 3) return { ok: false, statusCode: 401, message: "operator token is malformed" };
  const [header, payload, signature] = parts;
  const expected = hmac(`${header}.${payload}`, secret);
  if (!constantTimeTextEqual(signature, expected)) return { ok: false, statusCode: 401, message: "operator token signature mismatch" };

  let body;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, statusCode: 401, message: "operator token payload is invalid" };
  }

  if (body.exp && Math.floor(Date.now() / 1000) >= Number(body.exp)) {
    return { ok: false, statusCode: 401, message: "operator token expired" };
  }

  return { ok: true, payload: body };
}

function operatorJwtSecret() {
  const secret = process.env.OPERATOR_JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("OPERATOR_JWT_SECRET must be at least 32 characters in jwt auth mode");
  return secret;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeTextEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
