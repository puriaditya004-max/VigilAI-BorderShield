import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || path.join(os.tmpdir(), `bordershield-production-readiness-${Date.now()}.json`));

const checks = [
  commandCheck("node", process.execPath, ["--version"], true),
  commandCheck("python", process.env.PYTHON || "python", ["--version"], false),
  commandCheck("ffmpeg", process.env.FFMPEG_BIN || "ffmpeg", ["-version"], false),
  fileCheck("cameraConfig", args.cameraConfig || "edge/edge-agent/config/camera.json", true),
  fileCheck("zonesConfig", args.zonesConfig || "edge/analytics/config/zones.json", true),
  fileCheck("pythonRequirements", "edge/vision-runtime/python/requirements.txt", true),
  optionalFileCheck("modelFile", args.model),
  envCheck("ANPR_PLATE_DETECT_COMMAND", process.env.ANPR_PLATE_DETECT_COMMAND),
  envCheck("ANPR_OCR_COMMAND", process.env.ANPR_OCR_COMMAND),
  envCheck("FACE_DETECT_COMMAND", process.env.FACE_DETECT_COMMAND),
  envCheck("FFMPEG_BIN", process.env.FFMPEG_BIN || "ffmpeg"),
  envCheck("ALERT_WEBHOOK_URL", process.env.ALERT_WEBHOOK_URL)
];

const blockers = checks
  .filter((check) => check.required && check.status !== "PASS")
  .map((check) => check.name);
const optionalBlockers = checks
  .filter((check) => !check.required && check.status !== "PASS")
  .map((check) => check.name);

const report = {
  schemaVersion: "production-readiness-report.v1",
  generatedAt: new Date().toISOString(),
  summary: {
    readyForFixtureDemo: blockers.length === 0,
    readyForRealVideoValidation: blockers.length === 0 && !optionalBlockers.includes("python") && !optionalBlockers.includes("ffmpeg") && Boolean(args.model),
    blockers,
    optionalBlockers
  },
  checks,
  notes: [
    "This report checks runtime prerequisites only; it does not measure model accuracy.",
    "Configure ALERT_WEBHOOK_URL before production alert escalation drills.",
    "Real accuracy, false-alert rate and OCR quality remain NOT MEASURED without labelled footage."
  ]
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));

function commandCheck(name, command, commandArgs, required) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  return {
    name,
    type: "command",
    required,
    status: result.error ? "BLOCKED" : result.status === 0 ? "PASS" : "BLOCKED",
    command,
    output: (result.stdout || result.stderr || result.error?.message || "").split(/\r?\n/)[0]
  };
}

function fileCheck(name, filePath, required) {
  return {
    name,
    type: "file",
    required,
    status: fs.existsSync(path.resolve(filePath)) ? "PASS" : "BLOCKED",
    path: filePath
  };
}

function optionalFileCheck(name, filePath) {
  if (!filePath) return { name, type: "file", required: false, status: "BLOCKED", path: null };
  return fileCheck(name, filePath, false);
}

function envCheck(name, value) {
  return {
    name,
    type: "env",
    required: false,
    status: value ? "PASS" : "BLOCKED",
    configured: Boolean(value)
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") parsed.report = argv[index += 1];
    else if (arg === "--model") parsed.model = argv[index += 1];
    else if (arg === "--camera-config") parsed.cameraConfig = argv[index += 1];
    else if (arg === "--zones-config") parsed.zonesConfig = argv[index += 1];
  }
  return parsed;
}
