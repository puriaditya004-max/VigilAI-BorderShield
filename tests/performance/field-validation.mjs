import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  cleanupRuntime,
  collect,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const args = parseArgs(process.argv.slice(2));
const root = process.cwd();
const ctx = createRuntimeContext("field-validation");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const reportPath = path.resolve(args.report || path.join(os.tmpdir(), `bordershield-field-validation-${Date.now()}.json`));
const keyframeDir = path.resolve(args.keyframeDir || path.join(ctx.root, "keyframes"));
let server;

try {
  server = await startControlApi({ cwd: root, port, env: ctx.env });
  const startedAt = new Date();
  const pipeline = await runPipeline({ endpoint, source: args.source, model: args.model, maxFrames: args.maxFrames, keyframeDir, env: ctx.env });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const finishedAt = new Date();

  const report = buildReport({
    startedAt,
    finishedAt,
    pipeline,
    db,
    source: args.source,
    model: args.model,
    keyframeDir,
    validationMode: args.source ? "REAL_SOURCE_COMMAND" : "SIMULATED_FIXTURE"
  });

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));
} finally {
  await stopProcess(server);
  if (!args.keepRuntime) cleanupRuntime(ctx);
}

async function runPipeline({ endpoint, source, model, maxFrames, keyframeDir, env }) {
  const bridge = spawn(process.execPath, ["edge/analytics/src/track-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, ...env, CONTROL_API_URL: endpoint },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const producerArgs = source
    ? ["edge/vision-runtime/python/yolo_track_runtime.py", "--source", source, "--model", model || "yolov8n.pt", "--max-frames", String(maxFrames || 200), "--keyframe_dir", keyframeDir]
    : ["edge/vision-runtime/src/simulate-tracks.mjs"];
  const producer = spawn(source ? "python" : process.execPath, producerArgs, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  producer.stdout.pipe(bridge.stdin);
  const producerResult = await collect(producer, source ? 120000 : 10000);
  bridge.stdin.end();
  const bridgeResult = await collect(bridge, 30000);

  return {
    producer: {
      command: source ? "python edge/vision-runtime/python/yolo_track_runtime.py" : "node edge/vision-runtime/src/simulate-tracks.mjs",
      keyframeDir: source ? keyframeDir : null,
      exitCode: producerResult.code,
      stderr: producerResult.stderr.trim()
    },
    bridge: {
      command: "node edge/analytics/src/track-bridge.mjs",
      exitCode: bridgeResult.code,
      stdout: bridgeResult.stdout.trim(),
      stderr: bridgeResult.stderr.trim()
    }
  };
}

function buildReport({ startedAt, finishedAt, pipeline, db, source, model, keyframeDir, validationMode }) {
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const incidents = db.incidents || [];
  const evidence = db.evidence || [];

  return {
    schemaVersion: "field-validation-report.v1",
    generatedAt: finishedAt.toISOString(),
    validationMode,
    source: source || "simulated-track-fixture",
    model: model || "simulated-fixture",
    keyframeDir: source ? keyframeDir : null,
    durationMs,
    summary: {
      camerasRegistered: db.cameras?.length || 0,
      incidentsCreated: incidents.length,
      evidenceVerified: evidence.filter((item) => item.status === "VERIFIED").length,
      auditEvents: db.audits?.length || 0,
      pipelineSucceeded: pipeline.producer.exitCode === 0 && pipeline.bridge.exitCode === 0
    },
    gates: {
      controlApiStarted: true,
      trackProducerExitedCleanly: pipeline.producer.exitCode === 0,
      analyticsBridgeExitedCleanly: pipeline.bridge.exitCode === 0,
      incidentFlowObserved: incidents.length > 0,
      evidenceFlowObserved: evidence.length > 0,
      noAccuracyClaimWithoutLabels: true
    },
    measuredMetrics: {
      endToEndDurationMs: durationMs,
      incidentLatencyMs: "not_measured_without_real_capture_clock",
      visionFps: "not_measured_without_real_source",
      falseAlertRate: "not_measured_without_labelled_dataset",
      precision: "not_measured_without_labelled_dataset",
      recall: "not_measured_without_labelled_dataset"
    },
    pipeline,
    notes: [
      "Use --source <rtsp-url|camera-index|video-file> with installed Python runtime dependencies for real-source validation.",
      "Accuracy and false-alert metrics require a labelled dataset and should not be inferred from this fixture report."
    ]
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue || argv[index += 1];
    if (flag === "--source") parsed.source = nextValue();
    else if (flag === "--model") parsed.model = nextValue();
    else if (flag === "--report") parsed.report = nextValue();
    else if (flag === "--max-frames") parsed.maxFrames = Number(nextValue());
    else if (flag === "--keyframe-dir" || flag === "--keyframe_dir") parsed.keyframeDir = nextValue();
    else if (arg === "--keep-runtime") parsed.keepRuntime = true;
  }
  return parsed;
}
