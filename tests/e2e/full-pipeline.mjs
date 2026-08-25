import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(".");
const dbPath = path.join(root, "services/control-api/data/control-api.db.json");
const outboxDir = path.join(root, "edge/edge-agent/outbox");
const evidenceDir = path.join(root, "edge/edge-agent/data/evidence");
const port = 7180;
const endpoint = `http://localhost:${port}`;

cleanup();

const server = spawn(process.execPath, ["services/control-api/src/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth();

  const vision = spawn(process.execPath, ["edge/vision-runtime/src/simulate-tracks.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const bridge = spawn(process.execPath, ["edge/analytics/src/track-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, CONTROL_API_URL: endpoint },
    stdio: ["pipe", "pipe", "pipe"]
  });

  vision.stdout.pipe(bridge.stdin);
  const [visionResult, bridgeResult] = await Promise.all([collect(vision), collect(bridge)]);

  assert(visionResult.code === 0, `vision failed: ${visionResult.stderr}`);
  assert(bridgeResult.code === 0, `bridge failed: ${bridgeResult.stderr}`);

  const [html, cameras, incidents, evidence, audit] = await Promise.all([
    fetchText("/"),
    fetchJson("/api/cameras"),
    fetchJson("/api/incidents"),
    fetchJson("/api/evidence/manifests"),
    fetchJson("/api/audit")
  ]);

  assert(html.includes("VigilAI BorderShield"), "command UI should render");
  assert(cameras.length === 1, "camera should be registered");
  assert(incidents.length === 1, "one incident should be created");
  assert(evidence.length === 1, "one evidence manifest should be verified");
  assert(audit.some((event) => event.action === "camera.registered"), "camera audit missing");
  assert(audit.some((event) => event.action === "incident.created"), "incident audit missing");
  assert(audit.some((event) => event.action === "evidence.verified"), "evidence audit missing");
  assert(listFiles(evidenceDir, ".txt").length >= 1, "evidence artifact missing");
  assert(listFiles(outboxDir, ".json").length === 0, "outbox should be empty after online sync");

  console.log("PASS full-pipeline e2e");
} finally {
  server.kill();
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

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`${endpoint}/health`);
      if (response.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("control-api did not start");
}

function collect(child, timeoutMs = 10000) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ code: null, stdout, stderr }), timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function cleanup() {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
  for (const file of listFiles(outboxDir, ".json")) fs.rmSync(file, { force: true });
  for (const file of listFiles(evidenceDir, ".txt")) fs.rmSync(file, { force: true });
}

function listFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(extension))
    .map((file) => path.join(dir, file));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
