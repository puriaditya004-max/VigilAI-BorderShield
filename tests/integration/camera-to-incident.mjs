import fs from "node:fs";
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
const ctx = createRuntimeContext("camera-to-incident");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
let server;

try {
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const simulation = spawn(process.execPath, ["edge/analytics/src/simulate-fence.mjs"], {
    cwd: root,
    env: { ...process.env, ...ctx.env, CONTROL_API_URL: endpoint },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const result = await collect(simulation);
  if (result.code !== 0) {
    throw new Error(`simulation failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  assert(db.cameras.length === 1, "expected one registered camera");
  assert(db.incidents.length === 1, "expected one incident");
  assert(db.evidence.length === 1, "expected one evidence manifest");
  assert(db.incidents[0].type === "VIRTUAL_FENCE_INTRUSION", "expected virtual fence incident");
  assert(db.audits.some((event) => event.action === "incident.created"), "expected incident audit event");
  assert(db.audits.some((event) => event.action === "evidence.verified"), "expected evidence audit event");
  assert(listFiles(ctx.evidenceDir, ".svg").length >= 1, "expected visual evidence keyframe");

  console.log("PASS camera-to-incident integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
