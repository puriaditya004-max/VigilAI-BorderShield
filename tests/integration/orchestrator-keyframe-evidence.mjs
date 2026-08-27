import fs from "node:fs";
import path from "node:path";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";
import { runEdgeOrchestrator } from "../../edge/orchestrator/src/edge-orchestrator.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("orchestrator-keyframe-evidence");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const configPath = path.join(ctx.root, "edge-pipeline.keyframe.json");
const keyframeDir = path.join(ctx.root, "producer-keyframes");
let server;

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  fs.writeFileSync(configPath, JSON.stringify(orchestratorConfig(), null, 2));
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const summary = await runEdgeOrchestrator({
    configPath,
    mode: "python-yolo",
    source: "0",
    model: "fixture.pt",
    keyframeDir,
    endpoint,
    env: { ...process.env, ...ctx.env },
    log: () => {}
  });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const evidence = db.evidence[0];

  assert(summary.pipelineSucceeded === true, "orchestrator should complete");
  assert(summary.keyframeDir === keyframeDir, "orchestrator should report configured keyframe dir");
  assert(fs.readdirSync(keyframeDir).some((name) => name.endsWith(".jpg")), "producer should write keyframes");
  assert(db.incidents.length === 1, "crossing should create one incident");
  assert(evidence.metadata.evidenceMode !== "SVG_FIXTURE", "keyframe-dir producer should create non-SVG evidence");
  assert(evidence.metadata.evidenceMode === "REAL_FRAME_KEYFRAME", "bridge should copy producer keyframe evidence");
  assert(evidence.assets[0].contentType === "image/jpeg", "real keyframe should retain jpeg content type");

  console.log("PASS orchestrator-keyframe-evidence integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

function orchestratorConfig() {
  return {
    mode: "python-yolo",
    controlApiUrl: endpoint,
    cameraConfig: "edge/edge-agent/config/camera.json",
    zonesConfig: "edge/analytics/config/zones.json",
    producer: {
      pythonYolo: {
        command: process.execPath,
        args: [
          "tests/fixtures/mock-yolo-keyframe-producer.mjs",
          "--source",
          "{source}",
          "--camera-id",
          "{cameraId}",
          "--model",
          "{model}"
        ]
      }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
