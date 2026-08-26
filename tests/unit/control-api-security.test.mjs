import assert from "node:assert/strict";
import {
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

console.log("PASS control-api-security unit");
