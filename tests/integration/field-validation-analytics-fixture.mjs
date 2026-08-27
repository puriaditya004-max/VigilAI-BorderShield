import { spawn } from "node:child_process";
import { collect } from "../helpers/runtime.mjs";

const result = await collect(spawn(process.execPath, [
  "tests/performance/field-validation.mjs",
  "--check-suspicious-activity",
  "--check-night-watch"
], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"]
}), 30000);

assert(result.code === 0, `field validation should exit cleanly: ${result.stderr}`);

const report = JSON.parse(result.stdout);
const checks = report.summary.analyticsChecks;

assert(report.summary.pipelineSucceeded === true, "fixture pipeline should succeed");
assert(checks.suspiciousActivity.observed === true, "fixture should exercise suspicious-activity analytics when requested");
assert(checks.suspiciousActivity.incidentCount > 0, "fixture should create suspicious-activity incidents when requested");
assert(checks.nightWatch.observed === true, "fixture should exercise night/tamper analytics when requested");
assert(checks.nightWatch.nightMovementCount > 0, "fixture should create night-movement incidents when requested");
assert(checks.nightWatch.cameraTamperCount > 0, "fixture should create camera-tamper incidents when requested");

console.log("PASS field-validation-analytics-fixture integration");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
