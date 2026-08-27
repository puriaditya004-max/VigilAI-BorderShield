import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const keyframeDir = args.keyframe_dir || args.keyframeDir;
if (!keyframeDir) {
  console.error("missing --keyframe_dir");
  process.exit(2);
}

fs.mkdirSync(keyframeDir, { recursive: true });

for (const [index, x] of [500, 700].entries()) {
  const captureTime = new Date(Date.parse("2026-08-27T00:00:00.000Z") + index * 1000).toISOString();
  const framePath = path.resolve(keyframeDir, `mock-yolo-keyframe-${index + 1}.jpg`);
  const payload = Buffer.from(`mock-yolo-keyframe-${index + 1}`);
  fs.writeFileSync(framePath, payload);
  console.log(JSON.stringify({
    schemaVersion: "track-event.v1",
    eventId: `evt-mock-yolo-keyframe-${index + 1}`,
    cameraId: args.cameraId || "cam-bop-01-east",
    trackId: "person-keyframe",
    objectClass: "PERSON",
    confidence: 0.92,
    bbox: { x: x - 30, y: 160, width: 60, height: 140 },
    trajectory: [{ x, y: 300, t: captureTime }],
    frame: {
      uri: `file://${framePath.replaceAll("\\", "/")}`,
      sha256: crypto.createHash("sha256").update(payload).digest("hex")
    },
    frameAnalysis: {
      frameId: `frame-mock-yolo-keyframe-${index + 1}`,
      brightness: 0.4,
      contrast: 0.3,
      sharpness: 0.5,
      blockedRatio: 0.02,
      signalLost: false
    },
    captureTime,
    model: {
      name: "mock-yolo-keyframe-producer",
      version: "fixture",
      checksum: "sha256:test"
    }
  }));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replaceAll("-", "_");
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[index += 1] : true;
  }
  return parsed;
}
