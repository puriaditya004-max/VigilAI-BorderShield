import fs from "node:fs";
import { Readable } from "node:stream";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  listFiles
} from "../helpers/runtime.mjs";
import { runTrackBridge } from "../../edge/analytics/src/track-bridge.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("offline-startup-queue");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const previous = snapshotEnv(["EVIDENCE_DIR", "EDGE_OUTBOX_DIR"]);

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;

  const input = Readable.from([
    trackEvent({ x: 600, t: "2026-08-27T00:00:00.000Z" }),
    trackEvent({ x: 670, t: "2026-08-27T00:00:01.000Z" })
  ].map((event) => `${JSON.stringify(event)}\n`));

  const emitted = await runTrackBridge({ input, endpoint });
  const queued = listFiles(ctx.outboxDir, ".json");
  const queuedIncident = JSON.parse(fs.readFileSync(queued[0], "utf8"));

  assert(emitted.length === 1, "offline startup should still evaluate and emit one incident");
  assert(queued.length === 1, "incident should be queued when command API is unavailable from startup");
  assert(queuedIncident.type === "VIRTUAL_FENCE_INTRUSION", "queued incident should be the real fence incident");

  console.log("PASS offline-startup-queue integration");
} finally {
  restoreEnv(previous);
  cleanupRuntime(ctx);
}

function trackEvent({ x, t }) {
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-offline-startup-${Date.parse(t)}`,
    cameraId: "cam-bop-01-east",
    trackId: "offline-startup-track",
    objectClass: "PERSON",
    confidence: 0.9,
    bbox: { x: x - 30, y: 120, width: 60, height: 160 },
    trajectory: [{ x, y: 300, t }],
    captureTime: t,
    model: {
      name: "offline-startup-fixture",
      version: "fixture",
      checksum: "sha256:test"
    }
  };
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
