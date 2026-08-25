import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

export function createRuntimeContext(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bordershield-${name}-`));
  const controlDataDir = path.join(root, "control-api");
  const outboxDir = path.join(root, "outbox");
  const evidenceDir = path.join(root, "evidence");

  return {
    root,
    controlDataDir,
    dbPath: path.join(controlDataDir, "control-api.db.json"),
    outboxDir,
    evidenceDir,
    env: {
      CONTROL_API_DATA_DIR: controlDataDir,
      EDGE_OUTBOX_DIR: outboxDir,
      EVIDENCE_DIR: evidenceDir
    }
  };
}

export async function startControlApi({ cwd, port, env = {} }) {
  const child = spawn(process.execPath, ["services/control-api/src/server.mjs"], {
    cwd,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await waitForHealth(`http://localhost:${port}`);
  return child;
}

export async function waitForHealth(endpoint) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`${endpoint}/health`);
      if (response.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`control-api did not start at ${endpoint}`);
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

export function cleanupRuntime(ctx) {
  if (ctx?.root && fs.existsSync(ctx.root)) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
}

export function collect(child, timeoutMs = 10000) {
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

export function listFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(extension))
    .map((file) => path.join(dir, file));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
