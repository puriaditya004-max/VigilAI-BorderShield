import { spawn } from "node:child_process";

export async function runJsonCommand(command, args, { timeoutMs = 30000, env = process.env } = {}) {
  if (!command) {
    return { ok: false, error: "runtime command is not configured" };
  }

  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ code: null, timedOut: true });
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, timedOut: false });
    });
  });

  if (result.timedOut) return { ok: false, error: "runtime command timed out", stderr: stderr.trim() };
  if (result.code !== 0) return { ok: false, error: `runtime command exited ${result.code}`, stderr: stderr.trim() };

  try {
    return { ok: true, data: stdout.trim() ? JSON.parse(stdout) : null, stderr: stderr.trim() };
  } catch (error) {
    return { ok: false, error: `runtime command returned invalid JSON: ${error.message}`, stderr: stderr.trim() };
  }
}

export function applyArgTemplate(args, values) {
  return args.map((arg) => String(arg).replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] ?? ""));
}
