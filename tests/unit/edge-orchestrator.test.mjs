import assert from "node:assert/strict";
import {
  buildProducerSpec,
  parseCliArgs
} from "../../edge/orchestrator/src/edge-orchestrator.mjs";
import { normalizeCameraSource } from "../../edge/edge-agent/src/camera-source.mjs";

const camera = normalizeCameraSource({
  cameraId: "cam-bop-01-east",
  name: "East",
  edgeNodeId: "edge-bop-01",
  streamUri: "rtsp://operator:secret@camera.local/stream1",
  runtime: { mode: "CPU" }
});

const config = {
  producer: {
    simulator: {
      command: "node",
      args: ["edge/vision-runtime/src/simulate-tracks.mjs"]
    },
    pythonYolo: {
      command: "python",
      args: [
        "edge/vision-runtime/python/yolo_track_runtime.py",
        "--source",
        "{source}",
        "--camera-id",
        "{cameraId}",
        "--model",
        "{model}",
        "--keyframe_dir",
        "{keyframeDir}"
      ],
      keyframeDir: "reports/keyframes",
      model: "yolov8n.pt"
    }
  }
};

const simulator = buildProducerSpec({ config, mode: "simulator", camera });
assert.equal(simulator.command, "node");
assert.deepEqual(simulator.args, ["edge/vision-runtime/src/simulate-tracks.mjs"]);
assert.equal(simulator.source, "simulator");

const python = buildProducerSpec({
  config,
  mode: "python-yolo",
  camera,
  source: "0",
  model: "custom.pt",
  keyframeDir: "tmp/keyframes",
  preview: true,
  zonesConfig: "tmp/zones.json"
});
assert.equal(python.command, "python");
assert.deepEqual(python.args, [
  "edge/vision-runtime/python/yolo_track_runtime.py",
  "--source",
  "0",
  "--camera-id",
  "cam-bop-01-east",
  "--model",
  "custom.pt",
  "--keyframe_dir",
  "tmp/keyframes",
  "--zones-config",
  "tmp/zones.json",
  "--preview"
]);
assert.equal(python.source, "0");
assert.equal(python.keyframeDir, "tmp/keyframes");
assert.equal(python.preview, true);

assert.deepEqual(parseCliArgs(["--mode=python-yolo", "--source=0", "--max-frames=10", "--keyframe-dir=reports/keyframes", "--preview"]), {
  mode: "python-yolo",
  source: "0",
  max_frames: "10",
  keyframe_dir: "reports/keyframes",
  preview: true
});

assert.deepEqual(parseCliArgs(["--mode", "python-yolo", "--keyframe-dir", "tmp/keyframes"]), {
  mode: "python-yolo",
  keyframe_dir: "tmp/keyframes"
});

console.log("PASS edge-orchestrator unit");
