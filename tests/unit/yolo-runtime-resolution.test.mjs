import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = `
import importlib.util
import io
import json
import pathlib

runtime = pathlib.Path("edge/vision-runtime/python/yolo_track_runtime.py").resolve()
spec = importlib.util.spec_from_file_location("yolo_track_runtime", runtime)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakeCapture:
    def __init__(self):
        self.values = {}
        self.calls = []
    def set(self, key, value):
        self.calls.append([key, value])
        self.values[key] = value
        return True
    def get(self, key):
        return self.values.get(key, 0)

cap = FakeCapture()
result = module.configure_capture_resolution(cap)
stream = io.StringIO()
module.log_capture_resolution(result, stream=stream)

def event_for(source_width, source_height, xyxy):
    transform = module.build_coordinate_transform(source_width, source_height)
    return module.track_event("cam-test", {
        "class_id": 0,
        "confidence": 0.91,
        "track_id": f"{source_width}x{source_height}",
        "xyxy": xyxy,
        "coordinate_transform": transform
    }, "test-model.pt")

print(json.dumps({
    "result": result,
    "calls": cap.calls,
    "log": stream.getvalue(),
    "transform640": module.build_coordinate_transform(640, 480),
    "transform1920": module.build_coordinate_transform(1920, 1080),
    "transform1280": module.build_coordinate_transform(1280, 720),
    "invalid": module.build_coordinate_transform(0, 720),
    "event640": event_for(640, 480, [300, 100, 340, 220]),
    "event1920": event_for(1920, 1080, [930, 150, 990, 420]),
    "event1280": event_for(1280, 720, [620, 100, 660, 280])
}))
`;

const commands = process.env.PYTHON ? [[process.env.PYTHON]] : [["python"], ["py", "-3"]];
let result;
for (const command of commands) {
  result = spawnSync(command[0], [...command.slice(1), "-c", script], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (!result.error) break;
}

if (result.error) {
  console.log("SKIP yolo-runtime-resolution unit: python not available");
  process.exit(0);
}

assert.equal(result.status, 0, result.stderr);
const payload = JSON.parse(result.stdout);

assert.deepEqual(payload.result.requested, { width: 1280, height: 720 });
assert.deepEqual(payload.result.actual, { width: 1280, height: 720 });
assert.equal(payload.result.matches_zone_geometry, true);
assert.deepEqual(payload.calls, [[3, 1280], [4, 720]]);
assert.match(payload.log, /Capture resolution requested=1280x720 actual=1280x720 matches_zone_geometry=true/);

assert.equal(payload.transform640.valid, true);
assert.equal(payload.transform640.mode, "aspect_fit_letterbox");
assert.equal(payload.transform640.scale, 1.5);
assert.deepEqual(payload.transform640.padding, { x: 160, y: 0 });
assert.equal(payload.transform1920.scale, 2 / 3);
assert.deepEqual(payload.transform1920.padding, { x: 0, y: 0 });
assert.equal(payload.transform1280.scale, 1);
assert.deepEqual(payload.transform1280.padding, { x: 0, y: 0 });
assert.equal(payload.invalid.valid, false);
assert.equal(payload.invalid.reason, "INVALID_FRAME_DIMENSIONS");

assert.equal(payload.event640.sourceBbox.x, 300);
assert.equal(payload.event640.bbox.x, 610);
assert.equal(payload.event640.bbox.y, 150);
assert.equal(payload.event640.bbox.width, 60);
assert.equal(payload.event640.bbox.height, 180);
assert.equal(payload.event640.trajectory[0].x, 640);
assert.equal(payload.event640.trajectory[0].y, 330);
assert.equal(payload.event640.coordinateSpace.canonical.width, 1280);

assert.equal(payload.event1920.trajectory[0].x, 640);
assert.equal(payload.event1920.trajectory[0].y, 280);
assert.equal(payload.event1280.trajectory[0].x, 640);
assert.equal(payload.event1280.trajectory[0].y, 280);

console.log("PASS yolo-runtime-resolution unit");
