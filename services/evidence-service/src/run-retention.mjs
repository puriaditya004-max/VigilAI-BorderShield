import { appendAudit, readDb, writeDb } from "../../control-api/src/store.mjs";
import { buildRetentionSummary, expireEvidenceManifests } from "./retention.mjs";

const db = await readDb();
const retention = expireEvidenceManifests(db);
appendAudit(db, {
  actor: "system-retention",
  action: "evidence.retention_run",
  resource: `expired:${retention.expired.length}`,
  requestId: "retention-cli"
});
await writeDb(db);

console.log(JSON.stringify({ ...retention, summary: buildRetentionSummary(db) }, null, 2));
