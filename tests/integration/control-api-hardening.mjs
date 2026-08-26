import fs from "node:fs";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("control-hardening");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
const camera = {
  cameraId: "cam-bop-01-east",
  name: "BOP 01 East Gate Camera",
  edgeNodeId: "edge-bop-01",
  location: "East perimeter",
  streamUri: "rtsp://camera.local/stream1"
};

let server;
try {
  server = await startControlApi({ cwd: root, port, env: ctx.env });

  const registered = await postJson("/api/cameras/register", camera, {});
  assert(registered.deviceKey?.startsWith("dev_"), "registration should return one-time device key");

  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  assert(!Object.hasOwn(db.cameras[0], "deviceKey"), "device key plaintext should not be stored");
  assert(db.cameras[0].deviceKeyHash?.length === 64, "device key hash should be stored");

  const camerasResponse = await fetch(`${endpoint}/api/cameras`);
  assert(camerasResponse.headers.get("x-content-type-options") === "nosniff", "security header missing");
  const cameras = await camerasResponse.json();
  assert(!Object.hasOwn(cameras[0], "deviceKey"), "device key should not leak through camera list");
  assert(!Object.hasOwn(cameras[0], "deviceKeyHash"), "device key hash should not leak through camera list");

  const invalidJson = await fetch(`${endpoint}/api/cameras/health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": registered.deviceKey },
    body: "{"
  });
  assert(invalidJson.status === 400, "invalid JSON should return 400");

  console.log("PASS control-api-hardening integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}

async function postJson(route, body, headers) {
  const response = await fetch(`${endpoint}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
