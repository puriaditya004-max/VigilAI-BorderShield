import assert from "node:assert/strict";
import argon2 from "argon2";
import {
  authenticateOperator,
  createRateLimiter,
  hashDeviceKey,
  issueDeviceKey,
  loginOperator,
  publicCamera,
  verifyDeviceKey
} from "../../services/control-api/src/security.mjs";

const key = issueDeviceKey();
const hash = hashDeviceKey(key);

assert(key.startsWith("dev_"));
assert.equal(hash.length, 64);
assert.equal(verifyDeviceKey({ providedKey: key, storedHash: hash }), true);
assert.equal(verifyDeviceKey({ providedKey: "wrong", storedHash: hash }), false);

const safeCamera = publicCamera({
  cameraId: "cam-1",
  name: "Camera",
  deviceKey: key,
  deviceKeyHash: hash
});
assert.equal(Object.hasOwn(safeCamera, "deviceKey"), false);
assert.equal(Object.hasOwn(safeCamera, "deviceKeyHash"), false);

const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 2 });
assert.equal(limiter.check("client-a", 0).allowed, true);
assert.equal(limiter.check("client-a", 100).allowed, true);
assert.equal(limiter.check("client-a", 200).allowed, false);
assert.equal(limiter.check("client-a", 1200).allowed, true);

const operator = await authenticateOperator(mockReq({ "x-operator-id": "op-1", "x-operator-role": "OPERATOR" }), {
  requiredPermission: "incident:acknowledge"
});
assert.equal(operator.ok, true);

const viewer = await authenticateOperator(mockReq({ "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }), {
  requiredPermission: "incident:acknowledge"
});
assert.equal(viewer.ok, false);
assert.equal(viewer.statusCode, 403);

const missing = await authenticateOperator(mockReq({}));
assert.equal(missing.ok, false);
assert.equal(missing.statusCode, 401);

const previousAuthMode = process.env.OPERATOR_AUTH_MODE;
process.env.OPERATOR_AUTH_MODE = "jwt";
const jwtMissing = await authenticateOperator(mockReq({}));
assert.equal(jwtMissing.ok, false);
assert.equal(jwtMissing.message, "operator bearer token is required");
restoreEnv("OPERATOR_AUTH_MODE", previousAuthMode);

const previousUsers = process.env.OPERATOR_USERS_JSON;
const previousSecret = process.env.OPERATOR_JWT_SECRET;
const passwordHash = await argon2.hash("border-shield-demo-pass");
process.env.OPERATOR_AUTH_MODE = "jwt";
process.env.OPERATOR_JWT_SECRET = "test-jwt-secret-with-at-least-32-characters";
process.env.OPERATOR_USERS_JSON = JSON.stringify([{
  username: "commander",
  operatorId: "commander-1",
  role: "COMMANDER",
  passwordHash
}]);
const login = await loginOperator({ username: "commander", password: "border-shield-demo-pass" });
assert.equal(login.ok, true);
assert.equal(login.operator.role, "COMMANDER");
const jwtOperator = await authenticateOperator(mockReq({ authorization: `Bearer ${login.token}` }), {
  requiredPermission: "incident:escalate"
});
assert.equal(jwtOperator.ok, true);
restoreEnv("OPERATOR_AUTH_MODE", previousAuthMode);
restoreEnv("OPERATOR_USERS_JSON", previousUsers);
restoreEnv("OPERATOR_JWT_SECRET", previousSecret);

console.log("PASS control-api-security unit");

function mockReq(headers) {
  return { headers };
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
