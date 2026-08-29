import assert from "node:assert/strict";
import fs from "node:fs";
import argon2 from "argon2";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("operator-login-flow");
const port = await getFreePort();
const endpoint = `http://localhost:${port}`;
let server;

try {
  const passwordHash = await argon2.hash("border-shield-demo-pass");
  server = await startControlApi({
    cwd: root,
    port,
    env: {
      ...ctx.env,
      STORE_DRIVER: "json",
      OPERATOR_AUTH_MODE: "jwt",
      OPERATOR_JWT_SECRET: "test-jwt-secret-with-at-least-32-characters",
      OPERATOR_USERS_JSON: JSON.stringify([{
        username: "commander",
        operatorId: "commander-1",
        role: "COMMANDER",
        passwordHash
      }])
    }
  });

  const response = await fetch(`${endpoint}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "login-flow-test"
    },
    body: JSON.stringify({
      username: "commander",
      password: "border-shield-demo-pass"
    })
  });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.operator.operatorId, "commander-1");
  assert.equal(body.operator.role, "COMMANDER");
  assert.equal(typeof body.token, "string");
  assert(body.token.length > 20, "login should issue a JWT");

  const health = await fetch(`${endpoint}/health`);
  assert.equal(health.status, 200, "control-api should remain alive after login");

  const db = JSON.parse(fs.readFileSync(ctx.dbPath, "utf8"));
  const loginAudit = db.audits.find((event) => event.action === "operator.login");
  assert.equal(loginAudit?.actor, "commander-1");
  assert.equal(loginAudit?.resource, "COMMANDER");

  console.log("PASS operator-login-flow integration");
} finally {
  await stopProcess(server);
  cleanupRuntime(ctx);
}
