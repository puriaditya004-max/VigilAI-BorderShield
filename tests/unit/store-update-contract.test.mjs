import assert from "node:assert/strict";
import fs from "node:fs";
import { cleanupRuntime, createRuntimeContext } from "../helpers/runtime.mjs";

const ctx = createRuntimeContext("store-update-contract");
const previousDataDir = process.env.CONTROL_API_DATA_DIR;

try {
  process.env.CONTROL_API_DATA_DIR = ctx.controlDataDir;
  const jsonStore = await import(`../../services/control-api/src/store-json.mjs?contract=${Date.now()}`);
  await jsonStore.ensureStore();

  const nullResult = await jsonStore.updateDb((db) => {
    db.audits.push({
      schemaVersion: "audit-event.v1",
      auditId: "aud-null-mutator",
      actor: "test",
      action: "store.contract_null",
      resource: "json",
      createdAt: "2026-08-29T00:00:00.000Z"
    });
    return null;
  });
  assert.equal(nullResult, null);
  assert.equal(JSON.parse(fs.readFileSync(ctx.dbPath, "utf8")).audits.length, 1);

  const undefinedResult = await jsonStore.updateDb((db) => {
    db.audits.push({
      schemaVersion: "audit-event.v1",
      auditId: "aud-undefined-mutator",
      actor: "test",
      action: "store.contract_undefined",
      resource: "json",
      createdAt: "2026-08-29T00:00:01.000Z"
    });
  });
  assert.equal(undefinedResult, undefined);
  assert.equal(JSON.parse(fs.readFileSync(ctx.dbPath, "utf8")).audits.length, 2);

  const asyncResult = await jsonStore.updateDb(async (db) => {
    db.audits.push({
      schemaVersion: "audit-event.v1",
      auditId: "aud-async-mutator",
      actor: "test",
      action: "store.contract_async",
      resource: "json",
      createdAt: "2026-08-29T00:00:02.000Z"
    });
    return "async-result";
  });
  assert.equal(asyncResult, "async-result");
  assert.equal(JSON.parse(fs.readFileSync(ctx.dbPath, "utf8")).audits.length, 3);

  console.log("PASS store-update-contract unit");
} finally {
  restoreEnv("CONTROL_API_DATA_DIR", previousDataDir);
  cleanupRuntime(ctx);
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
