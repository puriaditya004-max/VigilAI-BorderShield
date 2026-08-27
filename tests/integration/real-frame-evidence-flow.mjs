import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";
import { runTrackBridge } from "../../edge/analytics/src/track-bridge.mjs";
import { hashFile } from "../../services/evidence-service/src/manifest.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("real-frame-evidence-flow");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const sourceFramePath = path.join(ctx.root, "producer-keyframe.jpg");
const previousEvidenceDir = process.env.EVIDENCE_DIR;
const previousOutboxDir = process.env.EDGE_OUTBOX_DIR;
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  fs.writeFileSync(sourceFramePath, Buffer.from("producer frame bytes"));
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const input = Readable.from([
    trackEvent({ x: 600, y: 420, t: "2026-08-26T00:00:00.000Z" }),
    trackEvent({ x: 660, y: 425, t: "2026-08-26T00:00:01.000Z" })
  ].map((event) => `${JSON.stringify(event)}\n`));
  await runTrackBridge({ input, endpoint });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const manifest = db.evidence[0];
  const copiedPath = manifest.assets[0].uri.replace("file://", "");

  assert(manifest.metadata.evidenceMode === "REAL_FRAME_KEYFRAME", "bridge should use producer frame evidence when frame URI exists");
  assert(manifest.assets[0].contentType === "image/jpeg", "copied keyframe should retain JPEG content type");
  assert(fs.readFileSync(copiedPath, "utf8") === "producer frame bytes", "evidence asset should copy the source frame bytes");
  assert(!manifest.assets.some((asset) => asset.kind === "CLIP"), "real-frame keyframe should not fake an MP4 clip");

  console.log("PASS real-frame-evidence-flow integration");
} finally {
  await stopProcess(server);
  restoreEnv("EVIDENCE_DIR", previousEvidenceDir);
  restoreEnv("EDGE_OUTBOX_DIR", previousOutboxDir);
  cleanupRuntime(ctx);
}

function trackEvent(point) {
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-track-cam-bop-01-east-real-frame-${Date.parse(point.t)}`,
    cameraId: "cam-bop-01-east",
    trackId: "real-frame-track",
    objectClass: "PERSON",
    confidence: 0.89,
    bbox: { x: point.x - 35, y: point.y - 160, width: 70, height: 160 },
    trajectory: [point],
    frame: {
      uri: `file://${sourceFramePath.replaceAll("\\", "/")}`,
      sha256: hashFile(sourceFramePath)
    },
    captureTime: point.t,
    model: {
      name: "real-frame-evidence-fixture",
      version: "fixture",
      checksum: "sha256:test"
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
