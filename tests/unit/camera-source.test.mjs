import assert from "node:assert/strict";
import { normalizeCameraSource, inferSourceType, reconnectDelay, redactUri, StreamHealthTracker } from "../../edge/edge-agent/src/camera-source.mjs";
import { readJson, validateContract } from "../../packages/contracts/src/validate-contract.mjs";

const schema = readJson("packages/contracts/schemas/camera-health.schema.json");

assert.equal(inferSourceType("0"), "USB");
assert.equal(inferSourceType("rtsp://user:pass@host/stream"), "RTSP");
assert.equal(inferSourceType("onvif://192.168.1.20"), "ONVIF");
assert.equal(inferSourceType("fixtures/demo.mp4"), "VIDEO_FILE");

assert.equal(redactUri("rtsp://user:pass@host/stream"), "rtsp://***:***@host/stream");
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
