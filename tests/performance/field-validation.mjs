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
  const pipeline = await runPipeline({ endpoint, source: args.source, model: args.model, maxFrames: args.maxFrames, keyframeDir, preview: args.preview === true, env: ctx.env });
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
    preview: args.preview === true,
    validationMode: args.source ? "REAL_SOURCE_COMMAND" : "SIMULATED_FIXTURE",
    checks: {
      suspiciousActivity: args.checkSuspiciousActivity === true,
      nightWatch: args.checkNightWatch === true,
      mp4Clip: args.checkMp4Clip === true
    }
  });

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));
} finally {
  await stopProcess(server);
  if (!args.keepRuntime) cleanupRuntime(ctx);
}

async function runPipeline({ endpoint, source, model, maxFrames, keyframeDir, preview, env }) {
  const bridge = spawn(process.execPath, ["edge/analytics/src/track-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, ...env, CONTROL_API_URL: endpoint },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const producerArgs = source
    ? withOptionalPreview(["edge/vision-runtime/python/yolo_track_runtime.py", "--source", source, "--model", model || "yolov8n.pt", "--max-frames", String(maxFrames || 200), "--keyframe_dir", keyframeDir], preview)
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
      preview: source ? preview === true : false,
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

function buildReport({ startedAt, finishedAt, pipeline, db, source, model, keyframeDir, preview = false, validationMode, checks = {} }) {
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const incidents = db.incidents || [];
  const evidence = db.evidence || [];
  const evidenceChecks = buildEvidenceChecks(evidence);
  const analyticsChecks = buildAnalyticsChecks({ incidents, evidence, checks });

  return {
    schemaVersion: "field-validation-report.v1",
    generatedAt: finishedAt.toISOString(),
    validationMode,
    source: source || "simulated-track-fixture",
    model: model || "simulated-fixture",
    keyframeDir: source ? keyframeDir : null,
    previewEnabled: source ? preview === true : false,
    durationMs,
    summary: {
      camerasRegistered: db.cameras?.length || 0,
      incidentsCreated: incidents.length,
      evidenceVerified: evidence.filter((item) => item.status === "VERIFIED").length,
      auditEvents: db.audits?.length || 0,
      pipelineSucceeded: pipeline.producer.exitCode === 0 && pipeline.bridge.exitCode === 0,
      evidenceModes: evidenceChecks.evidenceModes,
      nonSvgEvidenceObserved: evidenceChecks.nonSvgEvidenceObserved,
      facePrivacyMetadataObserved: evidenceChecks.facePrivacyMetadataObserved,
      facePrivacyPathConnected: evidenceChecks.facePrivacyPathConnected,
      faceRedactionMetadataObserved: evidenceChecks.faceRedactionMetadataObserved,
      plateRedactionMetadataObserved: evidenceChecks.plateRedactionMetadataObserved,
      platePrivacyPathConnected: evidenceChecks.platePrivacyPathConnected,
      analyticsChecks
    },
    gates: {
      controlApiStarted: true,
      trackProducerExitedCleanly: pipeline.producer.exitCode === 0,
      analyticsBridgeExitedCleanly: pipeline.bridge.exitCode === 0,
      incidentFlowObserved: incidents.length > 0,
      evidenceFlowObserved: evidence.length > 0,
      nonSvgEvidenceObserved: evidenceChecks.nonSvgEvidenceObserved,
      facePrivacyMetadataObserved: validationMode === "REAL_SOURCE_COMMAND" ? evidenceChecks.facePrivacyMetadataObserved : "not_applicable_for_simulated_fixture",
      plateRedactionMetadataObserved: validationMode === "REAL_SOURCE_COMMAND" ? evidenceChecks.plateRedactionMetadataObserved : "not_applicable_for_simulated_fixture",
      facePrivacyPathConnected: validationMode === "REAL_SOURCE_COMMAND" ? evidenceChecks.facePrivacyPathConnected : "not_applicable_for_simulated_fixture",
      platePrivacyPathConnected: validationMode === "REAL_SOURCE_COMMAND" ? evidenceChecks.platePrivacyPathConnected : "not_applicable_for_simulated_fixture",
      noAccuracyClaimWithoutLabels: true
    },
    analyticsChecks,
    evidenceChecks,
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
      "For real demos, confirm nonSvgEvidenceObserved plus the privacy path connection fields; facePrivacyMetadataObserved and plateRedactionMetadataObserved require actual detections in the captured frames.",
      "Accuracy and false-alert metrics require a labelled dataset and should not be inferred from this fixture report."
    ]
  };
}

function buildEvidenceChecks(evidence) {
  const evidenceModes = [...new Set(evidence.map((item) => item.metadata?.evidenceMode || "UNKNOWN"))];
  const redactions = evidence.flatMap((item) => item.metadata?.redactions || []);
  const assetContentTypes = [...new Set(evidence.flatMap((item) => (item.assets || []).map((asset) => asset.contentType || "unknown")))];
  return {
    evidenceModes,
    assetContentTypes,
    nonSvgEvidenceObserved: evidence.some((item) => item.metadata?.evidenceMode && item.metadata.evidenceMode !== "SVG_FIXTURE"),
    facePrivacyPathConnected: evidence.some((item) => item.metadata?.privacy?.faceDetection?.enabled === true),
    facePrivacyMetadataObserved: evidence.some((item) => Number(item.metadata?.privacy?.faceDetection?.candidates || 0) > 0),
    faceDetectorConnected: evidence.some((item) => item.metadata?.privacy?.faceDetection?.detectorConnected === true),
    faceDetectorErrors: evidence.map((item) => item.metadata?.privacy?.faceDetection?.error).filter(Boolean),
    faceDetectionCandidateCounts: evidence
      .map((item) => item.metadata?.privacy?.faceDetection?.candidates)
      .filter((value) => value !== undefined),
    platePrivacyPathConnected: evidence.some((item) => item.metadata?.privacy?.plateDetection?.enabled === true),
    plateRedactionMetadataObserved: redactions.some((item) => item.targetType === "PLATE"),
    faceRedactionMetadataObserved: redactions.some((item) => item.targetType === "FACE"),
    plateDetectorConnected: evidence.some((item) => item.metadata?.privacy?.plateDetection?.detectorConnected === true),
    plateDetectorErrors: evidence.map((item) => item.metadata?.privacy?.plateDetection?.error).filter(Boolean),
    plateDetectionCandidateCounts: evidence
      .map((item) => item.metadata?.privacy?.plateDetection?.candidates)
      .filter((value) => value !== undefined),
    redactionTargets: redactions.map((item) => ({
      targetType: item.targetType,
      action: item.action,
      method: item.method,
      confidence: item.confidence,
      reasonCodes: item.reasonCodes || []
    }))
  };
}

function buildAnalyticsChecks({ incidents, evidence, checks }) {
  const incidentTypes = incidents.map((incident) => incident.type);
  const clipObserved = evidence.some((item) => item.clipUri);
  const mp4ClipObserved = evidence.some((item) => item.clipUri && item.assets?.some((asset) => asset.kind === "CLIP" && asset.contentType === "video/mp4"));
  return {
    suspiciousActivity: checks.suspiciousActivity ? {
      observed: incidentTypes.includes("SUSPICIOUS_ACTIVITY"),
      incidentCount: incidents.filter((incident) => incident.type === "SUSPICIOUS_ACTIVITY").length
    } : "not_requested",
    nightWatch: checks.nightWatch ? {
      observed: incidentTypes.some((type) => ["NIGHT_MOVEMENT", "CAMERA_TAMPER"].includes(type)),
      nightMovementCount: incidents.filter((incident) => incident.type === "NIGHT_MOVEMENT").length,
      cameraTamperCount: incidents.filter((incident) => incident.type === "CAMERA_TAMPER").length
    } : "not_requested",
    mp4Clip: checks.mp4Clip ? {
      observed: mp4ClipObserved,
      clipUriObserved: clipObserved,
      clipCount: evidence.filter((item) => item.clipUri).length,
      unavailableReasonCodes: [...new Set(evidence.flatMap((item) => item.metadata?.clipReasonCodes || []))]
    } : "not_requested"
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
    else if (arg === "--preview") parsed.preview = true;
    else if (arg === "--check-suspicious-activity") parsed.checkSuspiciousActivity = true;
    else if (arg === "--check-night-watch") parsed.checkNightWatch = true;
    else if (arg === "--check-mp4-clip") parsed.checkMp4Clip = true;
    else if (arg === "--keep-runtime") parsed.keepRuntime = true;
  }
  return parsed;
}

function withOptionalPreview(args, preview) {
  return preview ? [...args, "--preview"] : args;
}
