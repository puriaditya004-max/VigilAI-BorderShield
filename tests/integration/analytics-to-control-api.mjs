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
const ctx = createRuntimeContext("analytics-to-control-api");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const zonesPath = path.join(ctx.root, "zones.analytics.json");
const previousEvidenceDir = process.env.EVIDENCE_DIR;
const previousOutboxDir = process.env.EDGE_OUTBOX_DIR;
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  fs.writeFileSync(zonesPath, JSON.stringify([analyticsZone()], null, 2));
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const input = Readable.from(analyticsTrackEvents().map((event) => `${JSON.stringify(event)}\n`));
  const emitted = await runTrackBridge({ input, endpoint, zonesConfig: zonesPath });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const types = db.incidents.map((incident) => incident.type);

  assert(emitted.length >= 3, "bridge should emit analytics incidents");
  assert(types.includes("SUSPICIOUS_ACTIVITY"), "loitering should create a suspicious-activity incident");
  assert(types.includes("NIGHT_MOVEMENT"), "low-light movement should create a night-movement incident");
  assert(types.includes("CAMERA_TAMPER"), "frame quality should create a camera-tamper incident");
  assert(db.audits.filter((event) => event.action === "incident.created").length >= 3, "analytics incidents should be audited");
  assert(db.evidence.length >= 3, "analytics incidents should attach evidence manifests");

  console.log("PASS analytics-to-control-api integration");
} finally {
  await stopProcess(server);
  restoreEnv("EVIDENCE_DIR", previousEvidenceDir);
  restoreEnv("EDGE_OUTBOX_DIR", previousOutboxDir);
  cleanupRuntime(ctx);
}

function analyticsZone() {
  return {
    zoneId: "zone-analytics-watch",
    cameraId: "cam-bop-01-east",
    name: "Analytics watch zone",
    line: { a: { x: 1000, y: 0 }, b: { x: 1000, y: 720 } },
    direction: "LEFT_TO_RIGHT",
    severity: "HIGH",
    persistenceFrames: 1,
    minTrajectoryPoints: 2,
    objectClasses: ["PERSON"],
    cooldownMs: 15000,
    polygon: [
      { x: 0, y: 0 },
      { x: 900, y: 0 },
      { x: 900, y: 720 },
      { x: 0, y: 720 }
    ],
    analytics: {
      ruleVersion: "analytics.integration.v1",
      cooldownMs: 60000,
      suspicious: {
        loitering: { enabled: true, minDwellMs: 2000, severity: "HIGH" },
        repeatedBoundaryApproach: { enabled: false },
        crowdFormation: { enabled: false },
        suddenSpeedChange: { enabled: false }
      },
      night: {
        movement: { enabled: true, minBrightness: 0.2, minContrast: 0.1, severity: "HIGH" }
      },
      tamper: {
        frameQuality: { enabled: true, maxBlockedRatio: 0.7, minContrast: 0.04, minSharpness: 0.05, severity: "HIGH" }
      }
    }
  };
}

function analyticsTrackEvents() {
  return [
    trackEvent({ x: 200, y: 300, t: "2026-08-26T00:00:00.000Z" }),
    trackEvent({ x: 205, y: 302, t: "2026-08-26T00:00:01.000Z" }),
    trackEvent({ x: 210, y: 304, t: "2026-08-26T00:00:02.500Z" })
  ];
}

function trackEvent(point) {
  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-track-cam-bop-01-east-analytics-track-${Date.parse(point.t)}`,
    cameraId: "cam-bop-01-east",
    trackId: "analytics-track",
    objectClass: "PERSON",
    confidence: 0.9,
    bbox: { x: point.x - 30, y: point.y - 150, width: 60, height: 150 },
    trajectory: [point],
    frameAnalysis: {
      frameId: `frame-${Date.parse(point.t)}`,
      brightness: 0.03,
      contrast: 0.02,
      sharpness: 0.02,
      blockedRatio: 0.82,
      signalLost: false
    },
    captureTime: point.t,
    model: {
      name: "analytics-integration-fixture",
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
