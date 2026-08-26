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
const ctx = createRuntimeContext("anpr-bridge-flow");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const zonesPath = path.join(ctx.root, "zones.anpr.json");
const framePath = path.join(ctx.root, "vehicle-frame.png");
const previous = snapshotEnv([
  "EVIDENCE_DIR",
  "EDGE_OUTBOX_DIR",
  "ANPR_PLATE_DETECT_COMMAND",
  "ANPR_PLATE_DETECT_ARGS",
  "ANPR_OCR_COMMAND",
  "ANPR_OCR_ARGS"
]);
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  process.env.ANPR_PLATE_DETECT_COMMAND = process.execPath;
  process.env.ANPR_PLATE_DETECT_ARGS = "tests/fixtures/mock-plate-detector.mjs --image {imagePath}";
  process.env.ANPR_OCR_COMMAND = process.execPath;
  process.env.ANPR_OCR_ARGS = "tests/fixtures/mock-ocr-engine.mjs --image {imagePath}";
  fs.writeFileSync(framePath, Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(zonesPath, JSON.stringify([anprZone()], null, 2));
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const input = Readable.from(vehicleEvents().map((event) => `${JSON.stringify(event)}\n`));
  const emitted = await runTrackBridge({ input, endpoint, zonesConfig: zonesPath });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const anprIncident = db.incidents.find((incident) => incident.type === "ANPR_CANDIDATE");
  const anprEvidence = db.evidence.find((item) => item.metadata?.anpr);

  assert(emitted.some((incident) => incident.type === "ANPR_CANDIDATE"), "bridge should emit an ANPR incident");
  assert(anprIncident, "control API should store ANPR incident");
  assert(anprEvidence, "ANPR evidence metadata should be stored");
  assert(anprEvidence.metadata.anpr.maskedText === "MH****1234", "plate value should be masked in evidence metadata");
  assert(anprEvidence.metadata.anpr.rawTextRetained === false, "raw OCR retention should be disabled by default");
  assert(!("rawTexts" in anprEvidence.metadata.anpr), "raw OCR text should not be retained by default");

  console.log("PASS anpr-bridge-flow integration");
} finally {
  await stopProcess(server);
  restoreEnv(previous);
  cleanupRuntime(ctx);
}

function anprZone() {
  return {
    zoneId: "zone-anpr",
    cameraId: "cam-bop-01-east",
    name: "ANPR gate",
    line: { a: { x: 1200, y: 0 }, b: { x: 1200, y: 720 } },
    direction: "LEFT_TO_RIGHT",
    severity: "LOW",
    persistenceFrames: 1,
    minTrajectoryPoints: 2,
    objectClasses: ["PERSON"],
    analytics: {
      ruleVersion: "anpr.integration.v1",
      anpr: {
        enabled: true,
        severity: "LOW",
        voteOptions: { minVotes: 3, minConfidence: 0.65 },
        privacy: { enabled: true },
        retainRawText: false
      }
    }
  };
}

function vehicleEvents() {
  return [0, 1, 2].map((index) => {
    const captureTime = new Date(Date.parse("2026-08-26T00:00:00.000Z") + index * 1000).toISOString();
    return {
      schemaVersion: "track-event.v1",
      eventId: `evt-track-cam-bop-01-east-veh-anpr-${index}`,
      cameraId: "cam-bop-01-east",
      trackId: "veh-anpr",
      objectClass: "VEHICLE",
      confidence: 0.88,
      bbox: { x: 80 + index * 10, y: 110, width: 220, height: 130 },
      trajectory: [{ x: 190 + index * 10, y: 240, t: captureTime }],
      frame: { uri: `file://${framePath.replaceAll("\\", "/")}`, sha256: "a".repeat(64) },
      captureTime,
      model: {
        name: "anpr-bridge-fixture",
        version: "fixture",
        checksum: "sha256:test"
      }
    };
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
