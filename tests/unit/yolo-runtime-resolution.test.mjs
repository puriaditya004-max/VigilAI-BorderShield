import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = `
import importlib.util
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
print(json.dumps({"result": result, "calls": cap.calls}))
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

console.log("PASS yolo-runtime-resolution unit");
