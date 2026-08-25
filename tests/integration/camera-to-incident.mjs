import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(".");
const dbPath = path.join(root, "services/control-api/data/control-api.db.json");
const outboxDir = path.join(root, "edge/edge-agent/outbox");
const evidenceDir = path.join(root, "edge/edge-agent/data/evidence");

cleanupGeneratedState();

const server = spawn(process.execPath, ["services/control-api/src/server.mjs"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth();

  const simulation = spawn(process.execPath, ["edge/analytics/src/simulate-fence.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const result = await collect(simulation);
  if (result.code !== 0) {
    throw new Error(`simulation failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  assert(db.cameras.length === 1, "expected one registered camera");
  assert(db.incidents.length === 1, "expected one incident");
  assert(db.evidence.length === 1, "expected one evidence manifest");
  assert(db.incidents[0].type === "VIRTUAL_FENCE_INTRUSION", "expected virtual fence incident");
  assert(db.audits.some((event) => event.action === "incident.created"), "expected incident audit event");
  assert(db.audits.some((event) => event.action === "evidence.verified"), "expected evidence audit event");
  assert(fs.existsSync(evidenceDir), "expected evidence directory");
  assert(fs.readdirSync(evidenceDir).some((file) => file.endsWith(".svg")), "expected visual evidence keyframe");

  console.log("PASS camera-to-incident integration");
} finally {
  server.kill();
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch("http://localhost:7080/health");
      if (response.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("control-api did not start");
}

function cleanupGeneratedState() {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
  removeFiles(outboxDir, ".json");
  removeFiles(evidenceDir, ".txt");
  removeFiles(evidenceDir, ".svg");
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeFiles(dir, extension) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(extension)) fs.rmSync(path.join(dir, file), { force: true });
  }
}
