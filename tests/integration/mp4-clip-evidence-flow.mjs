import crypto from "node:crypto";
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
import { createMp4ClipEvidence } from "../../edge/analytics/src/evidence.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("mp4-clip-evidence-flow");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const frameA = path.join(ctx.root, "frame-a.jpg");
const frameB = path.join(ctx.root, "frame-b.jpg");
const zonesPath = path.join(ctx.root, "zones.mp4.json");
const previous = snapshotEnv(["EVIDENCE_DIR", "EDGE_OUTBOX_DIR"]);
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  fs.writeFileSync(frameA, Buffer.from("frame-a"));
  fs.writeFileSync(frameB, Buffer.from("frame-b"));
  fs.writeFileSync(zonesPath, JSON.stringify([mp4Zone()], null, 2));
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const input = Readable.from([
    trackEvent({ x: 610, framePath: frameA, t: "2026-08-27T00:00:00.000Z" }),
    trackEvent({ x: 670, framePath: frameB, t: "2026-08-27T00:00:01.000Z" })
  ].map((event) => `${JSON.stringify(event)}\n`));
  await runTrackBridge({
    input,
    endpoint,
    zonesConfig: zonesPath,
    createClipEvidence: (options) => createMp4ClipEvidence({
      ...options,
      runClip: async ({ args }) => {
        assert(args.some((arg) => String(arg).endsWith("frame-%06d.jpg")), "ffmpeg input pattern should match JPEG keyframe extension");
        fs.writeFileSync(args.at(-1), Buffer.from("000000206674797069736f6d0000020069736f6d69736f32617663316d703431", "hex"));
        return { ok: true, code: 0 };
      }
    })
  });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const manifest = db.evidence[0];
  const clipAsset = manifest.assets.find((asset) => asset.kind === "CLIP");
  const clipPath = manifest.clipUri.replace("file://", "");
  const clipBytes = fs.readFileSync(clipPath);

  assert(db.incidents[0].evidence.clipUri === manifest.clipUri, "incident should reference clip URI");
  assert(clipAsset, "evidence should include a CLIP asset");
  assert(clipAsset.contentType === "video/mp4", "clip asset should be video/mp4");
  assert(manifest.metadata.clipStatus === "AVAILABLE", "clip status should be available");
  assert(clipBytes.includes(Buffer.from("ftyp")), "clip should include MP4 ftyp signature");

  console.log("PASS mp4-clip-evidence-flow integration");
} finally {
  await stopProcess(server);
  restoreEnv(previous);
  cleanupRuntime(ctx);
}

function trackEvent({ x, framePath, t }) {
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-mp4-${Date.parse(t)}`,
    cameraId: "cam-bop-01-east",
    trackId: "mp4-track",
    objectClass: "PERSON",
    confidence: 0.9,
    bbox: { x: x - 30, y: 120, width: 60, height: 160 },
    trajectory: [{ x, y: 300, t }],
    frame: {
      uri: `file://${framePath.replaceAll("\\", "/")}`,
      sha256: sha256(framePath)
    },
    captureTime: t,
    model: {
      name: "mp4-fixture",
      version: "fixture",
      checksum: "sha256:test"
    }
  };
}

function mp4Zone() {
  return {
    zoneId: "zone-mp4",
    cameraId: "cam-bop-01-east",
    name: "MP4 evidence zone",
    line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
    direction: "LEFT_TO_RIGHT",
    severity: "HIGH",
    persistenceFrames: 1,
    minTrajectoryPoints: 2,
    objectClasses: ["PERSON"],
    analytics: { ruleVersion: "mp4.integration.v1" }
  };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
