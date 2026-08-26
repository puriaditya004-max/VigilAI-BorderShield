import fs from "node:fs";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";
import { runEdgeOrchestrator } from "../../edge/orchestrator/src/edge-orchestrator.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("edge-orchestrator-pipeline");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const previousEvidenceDir = process.env.EVIDENCE_DIR;
const previousOutboxDir = process.env.EDGE_OUTBOX_DIR;
let server;
const logs = [];

try {
  process.env.EVIDENCE_DIR = ctx.evidenceDir;
  process.env.EDGE_OUTBOX_DIR = ctx.outboxDir;
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const summary = await runEdgeOrchestrator({
    mode: "simulator",
    endpoint,
    env: { ...process.env, ...ctx.env },
    log: (entry) => logs.push(entry)
  });
  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));

  assert(summary.pipelineSucceeded === true, "orchestrator should report a successful pipeline");
  assert(summary.incidents === 1, "orchestrator should report one incident");
  assert(summary.sourceType === "RTSP", "camera source type should come from normalized camera config");
  assert(db.cameras.length === 1, "control API should register the camera");
  assert(db.incidents.length === 1, "control API should store the incident");
  assert(logs.some((entry) => entry.component === "edge-orchestrator" && entry.message === "starting edge pipeline"), "start log should be emitted");
  assert(logs.some((entry) => entry.component === "edge-orchestrator" && entry.message === "edge pipeline completed"), "completion log should be emitted");

  console.log("PASS edge-orchestrator-pipeline integration");
} finally {
  await stopProcess(server);
  restoreEnv("EVIDENCE_DIR", previousEvidenceDir);
  restoreEnv("EDGE_OUTBOX_DIR", previousOutboxDir);
  cleanupRuntime(ctx);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
