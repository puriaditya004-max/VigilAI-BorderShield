import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  listFiles
} from "../helpers/runtime.mjs";
import { runTrackBridge } from "../../edge/analytics/src/track-bridge.mjs";

const ctx = createRuntimeContext("same-millisecond-incident-ids");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const zonesConfigPath = path.join(ctx.root, "zones.json");
const previous = snapshotEnv(["EVIDENCE_DIR", "EDGE_OUTBOX_DIR"]);

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  fs.writeFileSync(zonesConfigPath, `${JSON.stringify([zone()], null, 2)}\n`);

  const captureTime = "2026-08-28T00:00:00.000Z";
  const input = Readable.from([
    trackEvent({ trackId: "same-ms-a", x: 600, captureTime }),
    trackEvent({ trackId: "same-ms-a", x: 670, captureTime }),
    trackEvent({ trackId: "same-ms-b", x: 600, captureTime }),
    trackEvent({ trackId: "same-ms-b", x: 670, captureTime })
  ].map((event) => `${JSON.stringify(event)}\n`));

  const emitted = await runTrackBridge({ input, endpoint, zonesConfig: zonesConfigPath });
  const eventIds = emitted.map((incident) => incident.eventId);
  const queuedFiles = listFiles(ctx.outboxDir, ".json");
  const queuedEventIds = queuedFiles.map((file) => JSON.parse(fs.readFileSync(file, "utf8")).eventId);

  assert(emitted.length === 2, "two same-millisecond crossings should emit two incidents");
  assert(new Set(eventIds).size === 2, "same-millisecond incident eventIds should be distinct");
  assert(queuedFiles.length === 2, "same-millisecond queued incidents should not overwrite each other");
  assert(new Set(queuedEventIds).size === 2, "queued outbox eventIds should remain distinct");

  console.log("PASS same-millisecond-incident-ids integration");
} finally {
  restoreEnv(previous);
  cleanupRuntime(ctx);
}

function trackEvent({ trackId, x, captureTime }) {
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-track-${trackId}-${x}`,
    cameraId: "cam-bop-01-east",
    trackId,
    objectClass: "PERSON",
    confidence: 0.9,
    bbox: { x: x - 30, y: 120, width: 60, height: 160 },
    trajectory: [{ x, y: 300, t: captureTime }],
    captureTime,
    model: {
      name: "same-ms-fixture",
      version: "fixture",
      checksum: "sha256:test"
    }
  };
}

function zone() {
  return {
    zoneId: "zone-east-fence",
    cameraId: "cam-bop-01-east",
    name: "East virtual fence",
    line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
    direction: "LEFT_TO_RIGHT",
    severity: "HIGH",
    persistenceFrames: 1,
    minTrajectoryPoints: 2,
    objectClasses: ["PERSON"],
    cooldownMs: 0
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
