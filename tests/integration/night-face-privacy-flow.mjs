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

const root = process.cwd();
const ctx = createRuntimeContext("night-face-privacy-flow");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const zonesPath = path.join(ctx.root, "zones.night-face.json");
const framePath = path.join(ctx.root, "night-face-frame.jpg");
const previous = snapshotEnv(["EVIDENCE_DIR", "EDGE_OUTBOX_DIR", "FACE_DETECT_COMMAND", "FACE_DETECT_ARGS"]);
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  process.env.FACE_DETECT_COMMAND = process.execPath;
  process.env.FACE_DETECT_ARGS = "tests/fixtures/mock-face-engine.mjs --image {imagePath}";
  fs.writeFileSync(framePath, Buffer.from("face frame bytes"));
  fs.writeFileSync(zonesPath, JSON.stringify([nightFaceZone()], null, 2));
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const input = Readable.from(nightMovementEvents().map((event) => `${JSON.stringify(event)}\n`));
  const emitted = await runTrackBridge({ input, endpoint, zonesConfig: zonesPath });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const evidence = db.evidence.find((manifest) => manifest.metadata?.privacy?.faceDetection);

  assert(emitted.some((incident) => incident.type === "NIGHT_MOVEMENT"), "night movement incident should be emitted");
  assert(evidence, "face privacy metadata should be attached to night evidence");
  assert(evidence.metadata.privacy.faceDetection.identityRecognition === false, "face runtime must remain redaction-only");
  assert(evidence.metadata.privacy.faceDetection.candidates === 1, "face detector fixture should find one face");
  assert(evidence.metadata.redactions.some((item) => item.targetType === "FACE" && item.action === "BLUR"), "face redaction target should be stored");

  console.log("PASS night-face-privacy-flow integration");
} finally {
  await stopProcess(server);
  restoreEnv(previous);
  cleanupRuntime(ctx);
}

function nightFaceZone() {
  return {
    zoneId: "zone-night-face",
    cameraId: "cam-bop-01-east",
    name: "Night privacy watch",
    line: { a: { x: 1000, y: 0 }, b: { x: 1000, y: 720 } },
    direction: "LEFT_TO_RIGHT",
    severity: "HIGH",
    persistenceFrames: 1,
    minTrajectoryPoints: 2,
    objectClasses: ["PERSON"],
    polygon: [
      { x: 0, y: 0 },
      { x: 900, y: 0 },
      { x: 900, y: 720 },
      { x: 0, y: 720 }
    ],
    analytics: {
      ruleVersion: "night.face.integration.v1",
      cooldownMs: 60000,
      privacy: { enabled: true, face: { enabled: true } },
      night: {
        movement: { enabled: true, minBrightness: 0.2, minContrast: 0.1, severity: "HIGH" }
      },
      tamper: {
        frameQuality: { enabled: false }
      }
    }
  };
}

function nightMovementEvents() {
  return [0, 1].map((index) => {
    const captureTime = new Date(Date.parse("2026-08-27T00:00:00.000Z") + index * 1000).toISOString();
    return {
      schemaVersion: "track-event.v1",
      eventId: `evt-night-face-${index}`,
      cameraId: "cam-bop-01-east",
      trackId: "person-night-face",
      objectClass: "PERSON",
      confidence: 0.91,
      bbox: { x: 180 + index * 5, y: 140, width: 70, height: 160 },
      trajectory: [{ x: 215 + index * 5, y: 310, t: captureTime }],
      frame: { uri: `file://${framePath.replaceAll("\\", "/")}`, sha256: "b".repeat(64) },
      frameAnalysis: {
        frameId: `frame-night-face-${index}`,
        brightness: 0.04,
        contrast: 0.03,
        sharpness: 0.5,
        blockedRatio: 0.05,
        signalLost: false
      },
      captureTime,
      model: {
        name: "night-face-fixture",
        version: "fixture",
        checksum: "sha256:test"
      }
    };
  });
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
