import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeCameraSource, redactUri } from "../../edge-agent/src/camera-source.mjs";
import { applyArgTemplate } from "../../vision-runtime/src/runtime-command.mjs";
import { runTrackBridge } from "../../analytics/src/track-bridge.mjs";

const DEFAULT_CONFIG = "edge/orchestrator/config/edge-pipeline.json";

export async function runEdgeOrchestrator({
  configPath = DEFAULT_CONFIG,
  mode,
  source,
  model,
  keyframeDir,
  endpoint,
  env = process.env,
  log = defaultLog
} = {}) {
  const startedAt = Date.now();
  const config = readJson(configPath);
  const cameraConfigPath = config.cameraConfig || "edge/edge-agent/config/camera.json";
  const camera = normalizeCameraSource(readJson(cameraConfigPath));
  const selectedMode = normalizeMode(mode || config.mode || "simulator");
  const producer = buildProducerSpec({ config, mode: selectedMode, camera, source, model, keyframeDir });

  const child = spawn(producer.command, producer.args, {
    cwd: process.cwd(),
    env: {
      ...env,
      CAMERA_CONFIG: cameraConfigPath,
      ZONES_CONFIG: config.zonesConfig || "edge/analytics/config/zones.json",
      CONTROL_API_URL: endpoint || config.controlApiUrl || env.CONTROL_API_URL || "http://localhost:7080"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      log({
        level: "info",
        component: "edge-producer",
        mode: selectedMode,
        message: line
      });
    }
  });

  const stop = () => {
    if (child.exitCode === null && !child.killed) child.kill();
  };
  const signals = ["SIGINT", "SIGTERM"];
  for (const signal of signals) process.once(signal, stop);

  try {
    log({
      level: "info",
      component: "edge-orchestrator",
      message: "starting edge pipeline",
      mode: selectedMode,
      cameraId: camera.cameraId,
      sourceType: camera.sourceType,
      source: redactUri(producer.source),
      runtimeMode: camera.runtime.mode
    });

    const incidents = await runTrackBridge({
      input: child.stdout,
      endpoint: endpoint || config.controlApiUrl || env.CONTROL_API_URL || "http://localhost:7080",
      cameraConfig: cameraConfigPath,
      zonesConfig: config.zonesConfig || "edge/analytics/config/zones.json"
    });
    const exit = await waitForExit(child);
    if (exit.code !== 0) {
      throw new Error(`producer exited ${exit.code}${stderr ? `: ${stderr.trim()}` : ""}`);
    }

    const summary = {
      pipelineSucceeded: true,
      mode: selectedMode,
      cameraId: camera.cameraId,
      sourceType: camera.sourceType,
      runtimeMode: camera.runtime.mode,
      keyframeDir: producer.keyframeDir || null,
      incidents: incidents.length,
      durationMs: Date.now() - startedAt
    };
    log({ level: "info", component: "edge-orchestrator", message: "edge pipeline completed", ...summary });
    return summary;
  } finally {
    for (const signal of signals) process.removeListener(signal, stop);
  }
}

export function buildProducerSpec({ config, mode, camera, source, model, keyframeDir }) {
  const selectedMode = normalizeMode(mode);
  if (selectedMode === "simulator") {
    const spec = config.producer?.simulator || {};
    return {
      command: spec.command || process.execPath,
      args: normalizeNodeArgs(spec.command, spec.args || ["edge/vision-runtime/src/simulate-tracks.mjs"]),
      source: "simulator"
    };
  }

  if (selectedMode === "python-yolo") {
    const spec = config.producer?.pythonYolo || {};
    const values = {
      source: source || camera.streamUri,
      cameraId: camera.cameraId,
      model: model || spec.model || "yolov8n.pt",
      keyframeDir: keyframeDir || spec.keyframeDir || defaultKeyframeDir()
    };
    return {
      command: spec.command || "python",
      args: ensureKeyframeDirArg(applyArgTemplate(spec.args || [
        "edge/vision-runtime/python/yolo_track_runtime.py",
        "--source",
        "{source}",
        "--camera-id",
        "{cameraId}",
        "--model",
        "{model}"
      ], values), values.keyframeDir),
      source: values.source,
      keyframeDir: values.keyframeDir
    };
  }

  throw new Error(`unsupported orchestrator mode: ${mode}`);
}

export function parseCliArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    const inlineValue = rest.join("=");
    const next = argv[index + 1];
    parsed[key.replaceAll("-", "_")] = inlineValue || (next && !next.startsWith("--") ? argv[index += 1] : true);
  }
  return parsed;
}

function normalizeMode(mode) {
  if (mode === "pythonYolo") return "python-yolo";
  return String(mode || "simulator").toLowerCase();
}

function normalizeNodeArgs(command, args) {
  if (command === "node") return args;
  return args;
}

function ensureKeyframeDirArg(args, keyframeDir) {
  if (args.some((arg) => arg === "--keyframe_dir" || arg === "--keyframe-dir")) return args;
  return [...args, "--keyframe_dir", keyframeDir];
}

function defaultKeyframeDir() {
  return path.resolve("reports/keyframes");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, signal: null, error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function defaultLog(entry) {
  console.error(JSON.stringify({ time: new Date().toISOString(), ...entry }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseCliArgs(process.argv.slice(2));
  runEdgeOrchestrator({
    configPath: args.config || DEFAULT_CONFIG,
    mode: args.mode,
    source: args.source,
    model: args.model,
    keyframeDir: args.keyframe_dir,
    endpoint: args.endpoint
  }).then((summary) => {
    console.log(JSON.stringify(summary));
  }).catch((error) => {
    console.error(JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      component: "edge-orchestrator",
      message: error.message
    }));
    process.exit(1);
  });
}
