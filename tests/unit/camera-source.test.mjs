import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeCameraSource, inferSourceType, loadSecretRef, reconnectDelay, redactUri, resolveStreamUri, StreamHealthTracker } from "../../edge/edge-agent/src/camera-source.mjs";
import { readJson, validateContract } from "../../packages/contracts/src/validate-contract.mjs";

const schema = readJson("packages/contracts/schemas/camera-health.schema.json");
const previousCameraSecret = process.env.CAMERA_SECRET_TEST;
process.env.CAMERA_SECRET_TEST = "rtsp://env-user:env-pass@camera.local/stream";

assert.equal(inferSourceType("0"), "USB");
assert.equal(inferSourceType("rtsp://user:pass@host/stream"), "RTSP");
assert.equal(inferSourceType("onvif://192.168.1.20"), "ONVIF");
assert.equal(inferSourceType("fixtures/demo.mp4"), "VIDEO_FILE");

assert.equal(redactUri("rtsp://user:pass@host/stream"), "rtsp://***:***@host/stream");
assert.equal(loadSecretRef("env:CAMERA_SECRET_TEST", { env: { CAMERA_SECRET_TEST: "rtsp://env-user:env-pass@camera.local/stream" } }), "rtsp://env-user:env-pass@camera.local/stream");

const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "camera-secret-"));
const secretPath = path.join(secretDir, "rtsp.txt");
fs.writeFileSync(secretPath, "rtsp://file-user:file-pass@camera.local/stream\n");
assert.equal(loadSecretRef(`file:${secretPath}`), "rtsp://file-user:file-pass@camera.local/stream");
assert.equal(resolveStreamUri({ streamUriRef: "env:CAMERA_SECRET_TEST" }, { env: { CAMERA_SECRET_TEST: "0" } }), "0");

assert.equal(reconnectDelay(1, { initialDelayMs: 500, maxDelayMs: 30000, multiplier: 2 }), 500);
assert.equal(reconnectDelay(4, { initialDelayMs: 500, maxDelayMs: 30000, multiplier: 2 }), 4000);
assert.equal(reconnectDelay(20, { initialDelayMs: 500, maxDelayMs: 30000, multiplier: 2 }), 30000);

const source = normalizeCameraSource({
  cameraId: "cam-test",
  name: "Test Camera",
  edgeNodeId: "edge-test",
  streamUri: "rtsp://user:pass@camera.local/stream1",
  frameSampling: { targetFps: 5, maxDecodeFps: 15 }
});

assert.equal(source.sourceType, "RTSP");
assert.equal(source.frameSampling.targetFps, 5);
assert.equal(source.streamUriRedacted, "rtsp://***:***@camera.local/stream1");

const referencedSource = normalizeCameraSource({
  cameraId: "cam-secret",
  name: "Secret Camera",
  edgeNodeId: "edge-test",
  streamUriRef: "env:CAMERA_SECRET_TEST"
});
assert.equal(referencedSource.streamUri, "rtsp://env-user:env-pass@camera.local/stream");
assert.equal(referencedSource.streamUriRedacted.includes("env-pass"), false);
assert.equal(referencedSource.streamUriRef, "env:CAMERA_SECRET_TEST");

const tracker = new StreamHealthTracker({
  cameraId: source.cameraId,
  edgeNodeId: source.edgeNodeId,
  streamUri: source.streamUri
});

tracker.connect(new Date("2026-08-26T00:00:00.000Z"));
tracker.observeFrame({
  captureTime: new Date("2026-08-26T00:00:01.000Z"),
  ingestTime: new Date("2026-08-26T00:00:01.120Z")
});
tracker.observeDroppedFrame();

const health = tracker.snapshot(new Date("2026-08-26T00:00:02.000Z"));
assert.equal(health.status, "ONLINE");
assert.equal(health.stream.uri.includes("pass"), false);
assert.equal(health.quality.averageLatencyMs, 120);
assert.equal(validateContract(schema, health, "CameraHealth").valid, true);

tracker.disconnect(new Date("2026-08-26T00:00:03.000Z"));
assert.equal(tracker.snapshot(new Date("2026-08-26T00:00:04.000Z")).status, "OFFLINE");

console.log("PASS camera-source unit");

if (previousCameraSecret === undefined) delete process.env.CAMERA_SECRET_TEST;
else process.env.CAMERA_SECRET_TEST = previousCameraSecret;
