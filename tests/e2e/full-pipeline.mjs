import { spawn } from "node:child_process";
import {
  cleanupRuntime,
  collect,
  createRuntimeContext,
  getFreePort,
  listFiles,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("full-pipeline");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
let server;

try {
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const vision = spawn(process.execPath, ["edge/vision-runtime/src/simulate-tracks.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const bridge = spawn(process.execPath, ["edge/analytics/src/track-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, ...ctx.env, CONTROL_API_URL: endpoint },
    stdio: ["pipe", "pipe", "pipe"]
  });

  vision.stdout.pipe(bridge.stdin);
  const [visionResult, bridgeResult] = await Promise.all([collect(vision), collect(bridge)]);

  assert(visionResult.code === 0, `vision failed: ${visionResult.stderr}`);
  assert(bridgeResult.code === 0, `bridge failed: ${bridgeResult.stderr}`);

  const [html, cameras, incidents, evidence, audit, metrics] = await Promise.all([
    fetchText("/"),
    fetchJson("/api/cameras"),
    fetchJson("/api/incidents"),
    fetchJson("/api/evidence/manifests"),
    fetchJson("/api/audit"),
    fetchJson("/api/metrics")
  ]);

  assert(html.includes("VigilAI BorderShield"), "command UI should render");
  assert(cameras.length === 1, "camera should be registered");
  assert(incidents.length === 1, "one incident should be created");
  assert(evidence.length === 1, "one evidence manifest should be verified");
  assert(audit.some((event) => event.action === "camera.registered"), "camera audit missing");
  assert(audit.some((event) => event.action === "incident.created"), "incident audit missing");
  assert(audit.some((event) => event.action === "evidence.verified"), "evidence audit missing");
  assert(metrics.incidents.open === 1, "metrics should report one open incident");
  assert(metrics.evidence.verified === 1, "metrics should report one verified evidence manifest");
  assert(listFiles(ctx.evidenceDir, ".svg").length >= 1, "evidence artifact missing");
  assert(listFiles(ctx.outboxDir, ".json").length === 0, "outbox should be empty after online sync");

  console.log("PASS full-pipeline e2e");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

async function fetchJson(route) {
  const response = await fetch(`${endpoint}${route}`);
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

async function fetchText(route) {
  const response = await fetch(`${endpoint}${route}`);
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.text();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
