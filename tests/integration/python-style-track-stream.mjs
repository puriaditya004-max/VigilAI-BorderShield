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
const ctx = createRuntimeContext("python-style-track-stream");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const previousEvidenceDir = process.env.EVIDENCE_DIR;
const previousOutboxDir = process.env.EDGE_OUTBOX_DIR;
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const input = Readable.from(pythonStyleEvents().map((event) => `${JSON.stringify(event)}\n`));
  const emitted = await runTrackBridge({ input, endpoint });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));

  assert(emitted.length === 1, "bridge should emit one incident from single-point track stream");
  assert(db.incidents.length === 1, "control API should store one incident");
  assert(db.incidents[0].type === "VIRTUAL_FENCE_INTRUSION", "incident type should be virtual fence");
  assert(db.incidents[0].reasonCodes.includes("ZONE_POLICY_MATCHED"), "policy reason should be preserved");

  console.log("PASS python-style-track-stream integration");
} finally {
  await stopProcess(server);
  restoreEnv("EVIDENCE_DIR", previousEvidenceDir);
  restoreEnv("EDGE_OUTBOX_DIR", previousOutboxDir);
  cleanupRuntime(ctx);
}

function pythonStyleEvents() {
  return [
    trackEvent({ x: 600, y: 420, t: "2026-08-26T00:00:00.000Z" }),
    trackEvent({ x: 625, y: 426, t: "2026-08-26T00:00:01.000Z" }),
    trackEvent({ x: 660, y: 432, t: "2026-08-26T00:00:02.000Z" })
  ];
}

function trackEvent(point) {
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-track-cam-bop-01-east-py-track-1-${Date.parse(point.t)}`,
    cameraId: "cam-bop-01-east",
    trackId: "py-track-1",
    objectClass: "PERSON",
    confidence: 0.88,
    bbox: { x: point.x - 35, y: point.y - 160, width: 70, height: 160 },
    trajectory: [point],
    captureTime: point.t,
    model: {
      name: "python-yolo-runtime-test",
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
