import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.CONTROL_API_DATA_DIR || "services/control-api/data");
const DB_PATH = path.join(DATA_DIR, "control-api.db.json");

const EMPTY_DB = {
  cameras: [],
  zones: [
    {
      zoneId: "zone-east-fence",
      cameraId: "cam-bop-01-east",
      name: "East virtual fence",
      line: { a: { x: 640, y: 0 }, b: { x: 640, y: 720 } },
      direction: "LEFT_TO_RIGHT",
      severity: "HIGH"
    }
  ],
  incidents: [],
  evidence: [],
  audits: []
};

export function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) writeDb(EMPTY_DB);
}

export function readDb() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

export function writeDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

export function updateDb(mutator) {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

export function appendAudit(db, { actor, action, resource, requestId }) {
  db.audits.push({
    schemaVersion: "audit-event.v1",
    auditId: `aud-${Date.now()}-${db.audits.length + 1}`,
    actor,
    action,
    resource,
    requestId,
    createdAt: new Date().toISOString()
  });
}
