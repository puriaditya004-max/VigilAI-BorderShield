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
const ctx = createRuntimeContext("privacy-redaction-bridge-flow");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const zonesPath = path.join(ctx.root, "zones.privacy-redaction.json");
const framePath = path.join(ctx.root, "privacy-frame.jpg");
const previous = snapshotEnv([
  "EVIDENCE_DIR",
  "EDGE_OUTBOX_DIR",
  "FACE_DETECT_COMMAND",
  "FACE_DETECT_ARGS",
  "ANPR_PLATE_DETECT_COMMAND",
  "ANPR_PLATE_DETECT_ARGS"
]);
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  process.env.FACE_DETECT_COMMAND = process.execPath;
  process.env.FACE_DETECT_ARGS = "tests/fixtures/mock-face-engine.mjs --image {imagePath}";
  process.env.ANPR_PLATE_DETECT_COMMAND = process.execPath;
  process.env.ANPR_PLATE_DETECT_ARGS = "tests/fixtures/mock-plate-detector.mjs --image {imagePath}";
  fs.writeFileSync(framePath, Buffer.from("privacy frame bytes"));
  fs.writeFileSync(zonesPath, JSON.stringify([privacyZone()], null, 2));
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const input = Readable.from(crossingEvents().map((event) => `${JSON.stringify(event)}\n`));
  const emitted = await runTrackBridge({ input, endpoint, zonesConfig: zonesPath });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const evidence = db.evidence.find((manifest) => manifest.metadata?.privacy?.faceDetection);

  assert(emitted.some((incident) => incident.type === "VIRTUAL_FENCE_INTRUSION"), "fence incident should be emitted");
  assert(evidence, "privacy metadata should be attached to evidence");
  assert(evidence.metadata.evidenceMode === "REAL_FRAME_KEYFRAME", "real frame keyframe evidence should be used");
  assert(evidence.metadata.privacy.faceDetection.detectorConnected === true, "face detector should be connected");
  assert(evidence.metadata.privacy.faceDetection.candidates === 1, "face detector fixture should find one face");
  assert(evidence.metadata.privacy.faceDetection.identityRecognition === false, "face detector must remain redaction-only");
  assert(evidence.metadata.privacy.plateDetection.detectorConnected === true, "plate detector should be connected");
  assert(evidence.metadata.privacy.plateDetection.candidates === 1, "plate detector fixture should find one plate");
  assert(evidence.metadata.redactions.some((item) => item.targetType === "FACE" && item.action === "BLUR"), "face redaction target should be stored");
  assert(evidence.metadata.redactions.some((item) => item.targetType === "PLATE" && item.action === "BLUR"), "plate redaction target should be stored");
  assert(!JSON.stringify(evidence.metadata).includes("faceEmbedding"), "biometric embeddings must not be emitted");

  console.log("PASS privacy-redaction-bridge-flow integration");
} finally {
  await stopProcess(server);
  restoreEnv(previous);
  cleanupRuntime(ctx);
}

function privacyZone() {
  return {
    zoneId: "zone-privacy",
    cameraId: "cam-bop-01-east",
    name: "Privacy evidence watch",
    line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
    direction: "LEFT_TO_RIGHT",
    severity: "HIGH",
    persistenceFrames: 1,
    minTrajectoryPoints: 2,
    objectClasses: ["PERSON"],
    analytics: {
      ruleVersion: "privacy.integration.v1",
      privacy: {
        enabled: true,
        face: { enabled: true },
        plate: { enabled: true }
      }
    }
  };
}

function crossingEvents() {
  return [0, 1].map((index) => {
    const captureTime = new Date(Date.parse("2026-08-27T00:00:00.000Z") + index * 1000).toISOString();
    const footX = index === 0 ? 610 : 670;
    return {
      schemaVersion: "track-event.v1",
      eventId: `evt-privacy-${index}`,
      cameraId: "cam-bop-01-east",
      trackId: "person-privacy",
      objectClass: "PERSON",
      confidence: 0.91,
      bbox: { x: footX - 35, y: 140, width: 70, height: 160 },
      trajectory: [{ x: footX, y: 300, t: captureTime }],
      frame: { uri: `file://${framePath.replaceAll("\\", "/")}`, sha256: "c".repeat(64) },
      captureTime,
      model: {
        name: "privacy-fixture",
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
