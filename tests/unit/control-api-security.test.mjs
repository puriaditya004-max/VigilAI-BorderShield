import assert from "node:assert/strict";
import {
  authenticateOperator,
  createRateLimiter,
  hashDeviceKey,
  issueDeviceKey,
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

console.log("PASS control-api-security unit");

function mockReq(headers) {
  return { headers };
}
