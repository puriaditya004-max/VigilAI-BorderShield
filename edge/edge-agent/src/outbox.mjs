import fs from "node:fs";
import path from "node:path";

const OUTBOX_DIR = path.resolve("edge/edge-agent/outbox");

export function ensureOutbox() {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
}

export function enqueueIncident(incident) {
  ensureOutbox();
  const file = path.join(OUTBOX_DIR, `${incident.eventId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(incident, null, 2)}\n`);
  return file;
}

export function listQueuedIncidents() {
  ensureOutbox();
  return fs.readdirSync(OUTBOX_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(OUTBOX_DIR, file));
}

export async function replayOutbox({ endpoint, deviceKey }) {
  const files = listQueuedIncidents();
  const results = [];

  for (const file of files) {
    const incident = JSON.parse(fs.readFileSync(file, "utf8"));
    const response = await fetch(`${endpoint}/api/incidents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-key": deviceKey,
        "idempotency-key": incident.eventId
      },
      body: JSON.stringify(incident)
    });

    if (response.ok) {
      fs.unlinkSync(file);
      results.push({ eventId: incident.eventId, status: "replayed" });
    } else {
      results.push({ eventId: incident.eventId, status: "failed", code: response.status });
    }
  }

  return results;
}
