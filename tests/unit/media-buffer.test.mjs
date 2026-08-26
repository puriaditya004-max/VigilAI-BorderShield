import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RollingFrameBuffer,
  buildFfmpegImageSequenceArgs,
  writeFrameSequence
} from "../../edge/analytics/src/media-buffer.mjs";

const buffer = new RollingFrameBuffer({ cameraId: "cam-1", maxDurationMs: 4000, maxFrames: 4 });
for (let index = 0; index < 6; index += 1) {
  buffer.addFrame({
    frameId: `frame-${index}`,
    uri: `file://frame-${index}.png`,
    captureTime: new Date(Date.parse("2026-08-26T00:00:00.000Z") + index * 1000).toISOString()
  });
}

assert.equal(buffer.frames.length, 4);
assert.deepEqual(buffer.frames.map((frame) => frame.frameId), ["frame-2", "frame-3", "frame-4", "frame-5"]);
assert.deepEqual(buffer.selectWindow({
  eventTime: "2026-08-26T00:00:04.000Z",
  preEventMs: 1000,
  postEventMs: 1000
}).map((frame) => frame.frameId), ["frame-3", "frame-4", "frame-5"]);

const args = buildFfmpegImageSequenceArgs({
  inputPattern: "frames/frame-%06d.png",
  outputPath: "incident.mp4",
  fps: 10
});
assert.deepEqual(args, [
  "-y",
  "-framerate",
  "10",
  "-i",
  "frames/frame-%06d.png",
  "-an",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  "incident.mp4"
]);
assert(!args.join(" ").includes(";"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "media-buffer-"));
const source = path.join(tmp, "source.png");
fs.writeFileSync(source, Buffer.from([137, 80, 78, 71]));
const written = writeFrameSequence({
  frames: [{ uri: `file://${source.replaceAll("\\", "/")}` }],
  directory: path.join(tmp, "sequence")
});
assert.equal(written.length, 1);
assert.equal(fs.existsSync(written[0]), true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("PASS media-buffer unit");
