import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "./run-migrations.mjs";
import { writeDb } from "./store-postgres.mjs";

const sourcePath = path.resolve(process.argv[2] || process.env.CONTROL_API_JSON_DB || "services/control-api/data/control-api.db.json");

if (!fs.existsSync(sourcePath)) {
  console.error(`JSON store not found: ${sourcePath}`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
validateDbShape(db);

await runMigrations();
await writeDb(db);

console.log(JSON.stringify({
  imported: {
    cameras: db.cameras.length,
    zones: db.zones.length,
    incidents: db.incidents.length,
    evidence: db.evidence.length,
    audits: db.audits.length
  },
  sourcePath
}, null, 2));

function validateDbShape(db) {
  for (const key of ["cameras", "zones", "incidents", "evidence", "audits"]) {
    if (!Array.isArray(db[key])) throw new Error(`invalid JSON store: ${key} must be an array`);
  }
}
