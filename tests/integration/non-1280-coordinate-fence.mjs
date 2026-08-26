import fs from "node:fs";
import { Readable } from "node:stream";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";
import { runTrackBridge } from "../../edge/analytics/src/track-bridge.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("non-1280-coordinate-fence");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const previousEvidenceDir = process.env.EVIDENCE_DIR;
const previousOutboxDir = process.env.EDGE_OUTBOX_DIR;
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const sourceEvents = [
    sourceTrackEvent({ sourceFootX: 300, sourceFootY: 260, t: "2026-08-26T00:00:00.000Z" }),
    sourceTrackEvent({ sourceFootX: 320, sourceFootY: 264, t: "2026-08-26T00:00:01.000Z" }),
    sourceTrackEvent({ sourceFootX: 340, sourceFootY: 268, t: "2026-08-26T00:00:02.000Z" })
  ];
  const input = Readable.from(sourceEvents.map((event) => `${JSON.stringify(event)}\n`));
  const emitted = await runTrackBridge({ input, endpoint });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));

  assert(emitted.length === 1, "bridge should emit one incident after non-1280 source coordinates cross canonical fence");
  assert(db.incidents.length === 1, "control API should store one incident");
  assert(db.incidents[0].type === "VIRTUAL_FENCE_INTRUSION", "incident type should be virtual fence");
  assert(db.incidents[0].cameraId === "cam-bop-01-east", "incident should stay associated with configured camera");

  console.log("PASS non-1280-coordinate-fence integration");
} finally {
  await stopProcess(server);
  restoreEnv("EVIDENCE_DIR", previousEvidenceDir);
  restoreEnv("EDGE_OUTBOX_DIR", previousOutboxDir);
  cleanupRuntime(ctx);
}

function sourceTrackEvent({ sourceFootX, sourceFootY, t }) {
  const sourceWidth = 640;
  const sourceHeight = 480;
  const coordinateSpace = buildCoordinateSpace(sourceWidth, sourceHeight, 1280, 720);
  const sourceBbox = { x: sourceFootX - 20, y: sourceFootY - 120, width: 40, height: 120 };
  const bbox = transformBbox(sourceBbox, coordinateSpace);
  const footpoint = {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height,
    t
  };

  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-track-cam-bop-01-east-640-track-1-${Date.parse(t)}`,
    cameraId: "cam-bop-01-east",
    trackId: "640-track-1",
    objectClass: "PERSON",
    confidence: 0.9,
    sourceBbox,
    coordinateSpace,
    bbox,
    trajectory: [footpoint],
    captureTime: t,
    model: {
      name: "python-yolo-runtime-coordinate-test",
      version: "fixture",
      checksum: "sha256:test"
    }
  };
}

function buildCoordinateSpace(sourceWidth, sourceHeight, canonicalWidth, canonicalHeight) {
  const scale = Math.min(canonicalWidth / sourceWidth, canonicalHeight / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;
  return {
    valid: true,
    mode: "aspect_fit_letterbox",
    source: { width: sourceWidth, height: sourceHeight },
    canonical: { width: canonicalWidth, height: canonicalHeight },
    scale,
    padding: {
      x: (canonicalWidth - scaledWidth) / 2,
      y: (canonicalHeight - scaledHeight) / 2
    }
  };
}

function transformBbox(bbox, coordinateSpace) {
  return {
    x: bbox.x * coordinateSpace.scale + coordinateSpace.padding.x,
    y: bbox.y * coordinateSpace.scale + coordinateSpace.padding.y,
    width: bbox.width * coordinateSpace.scale,
    height: bbox.height * coordinateSpace.scale
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
