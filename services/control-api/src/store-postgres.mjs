import pg from "pg";

const { Client } = pg;
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || "postgres://vigilai:vigilai@localhost:5433/vigilai";

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

export async function ensureStore() {
  const db = await readDb();
  if (db.zones.length === 0 && db.cameras.length === 0 && db.incidents.length === 0 && db.evidence.length === 0 && db.audits.length === 0) {
    await writeDb(EMPTY_DB);
  }
}

export async function readDb() {
  const client = await connect();
  try {
    return await readDbWithClient(client);
  } finally {
    await client.end();
  }
}

export async function writeDb(db) {
  const client = await connect();
  try {
    await client.query("BEGIN");
    await writeDbWithClient(client, db);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export async function updateDb(mutator) {
  const client = await connect();
  try {
    await client.query("BEGIN");
    const db = await readDbWithClient(client);
    const result = mutator(db);
    await writeDbWithClient(client, db);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
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

async function connect() {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function readDbWithClient(client) {
  const cameras = await client.query("SELECT record FROM cameras ORDER BY registered_at NULLS LAST, camera_id");
  const zones = await client.query("SELECT record FROM zones ORDER BY zone_id");
  const incidents = await client.query("SELECT record FROM incidents ORDER BY capture_time NULLS LAST, received_at NULLS LAST, event_id");
  const manifests = await client.query("SELECT record FROM evidence_manifests ORDER BY created_at NULLS LAST, manifest_id");
  const assets = await client.query("SELECT manifest_id, asset_index, record FROM evidence_assets ORDER BY manifest_id, asset_index");
  const audits = await client.query("SELECT record FROM audit_events ORDER BY created_at NULLS LAST, audit_id");

  const assetsByManifest = new Map();
  for (const row of assets.rows) {
    const list = assetsByManifest.get(row.manifest_id) || [];
    list[row.asset_index] = row.record;
    assetsByManifest.set(row.manifest_id, list);
  }

  return {
    cameras: cameras.rows.map((row) => row.record),
    zones: zones.rows.map((row) => row.record),
    incidents: incidents.rows.map((row) => row.record),
    evidence: manifests.rows.map((row) => ({
      ...row.record,
      assets: assetsByManifest.get(row.record.manifestId) || row.record.assets || []
    })),
    audits: audits.rows.map((row) => row.record)
  };
}

async function writeDbWithClient(client, db) {
  await client.query("DELETE FROM evidence_assets");
  await client.query("DELETE FROM evidence_manifests");
  await client.query("DELETE FROM audit_events");
  await client.query("DELETE FROM incidents");
  await client.query("DELETE FROM zones");
  await client.query("DELETE FROM cameras");

  for (const camera of db.cameras || []) await insertCamera(client, camera);
  for (const zone of db.zones || []) await insertZone(client, zone);
  for (const incident of db.incidents || []) await insertIncident(client, incident);
  for (const manifest of db.evidence || []) await insertEvidenceManifest(client, manifest);
  for (const audit of db.audits || []) await insertAuditEvent(client, audit);
}

async function insertCamera(client, camera) {
  await client.query(`
    INSERT INTO cameras (
      camera_id, name, edge_node_id, location, stream_uri, device_key_hash, status,
      registered_at, last_heartbeat, key_rotated_at, last_quality, last_stream, record
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
  `, [
    camera.cameraId,
    camera.name,
    camera.edgeNodeId,
    camera.location || "unknown",
    camera.streamUri || null,
    camera.deviceKeyHash || null,
    camera.status || "ONLINE",
    nullableDate(camera.registeredAt),
    nullableDate(camera.lastHeartbeat),
    nullableDate(camera.keyRotatedAt),
    json(camera.lastQuality),
    json(camera.lastStream),
    json(camera)
  ]);
}

async function insertZone(client, zone) {
  const { line, polygon, analytics, schedule, ...flatConfig } = zone;
  await client.query(`
    INSERT INTO zones (
      zone_id, camera_id, name, line, polygon, direction, severity, enabled, schedule, analytics, config, record
    ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb)
  `, [
    zone.zoneId,
    zone.cameraId,
    zone.name,
    json(line),
    json(polygon),
    zone.direction || null,
    zone.severity || null,
    zone.enabled ?? null,
    json(schedule),
    json(analytics),
    json(flatConfig),
    json(zone)
  ]);
}

async function insertIncident(client, incident) {
  await client.query(`
    INSERT INTO incidents (
      event_id, incident_id, camera_id, zone_id, type, severity, status, capture_time,
      received_at, idempotency_key, acknowledged_at, acknowledged_by, acknowledgement_note,
      escalated_at, escalated_by, escalation_target, escalation_note, evidence, reason_codes, record
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb)
  `, [
    incident.eventId,
    incident.incidentId,
    incident.cameraId,
    incident.zoneId,
    incident.type,
    incident.severity,
    incident.status || "OPEN",
    nullableDate(incident.captureTime),
    nullableDate(incident.receivedAt),
    incident.idempotencyKey || null,
    nullableDate(incident.acknowledgedAt),
    incident.acknowledgedBy || null,
    incident.acknowledgementNote || null,
    nullableDate(incident.escalatedAt),
    incident.escalatedBy || null,
    incident.escalationTarget || null,
    incident.escalationNote || null,
    json(incident.evidence || {}),
    json(incident.reasonCodes || []),
    json(incident)
  ]);
}

async function insertEvidenceManifest(client, manifest) {
  await client.query(`
    INSERT INTO evidence_manifests (
      manifest_id, incident_id, schema_version, created_at, received_at, status,
      sha256, keyframe_uri, clip_uri, metadata, record
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
  `, [
    manifest.manifestId,
    manifest.incidentId,
    manifest.schemaVersion,
    nullableDate(manifest.createdAt),
    nullableDate(manifest.receivedAt),
    manifest.status || "VERIFIED",
    manifest.sha256,
    manifest.keyframeUri || null,
    manifest.clipUri || null,
    json(manifest.metadata || {}),
    json(manifest)
  ]);

  const assets = manifest.assets || [];
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    await client.query(`
      INSERT INTO evidence_assets (manifest_id, asset_index, kind, uri, sha256, content_type, record)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    `, [
      manifest.manifestId,
      index,
      asset.kind,
      asset.uri,
      asset.sha256,
      asset.contentType || null,
      json(asset)
    ]);
  }
}

async function insertAuditEvent(client, audit) {
  await client.query(`
    INSERT INTO audit_events (audit_id, actor, action, resource, request_id, created_at, record)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
  `, [
    audit.auditId,
    audit.actor,
    audit.action,
    audit.resource,
    audit.requestId || null,
    nullableDate(audit.createdAt),
    json(audit)
  ]);
}

function nullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function json(value) {
  return value === undefined ? null : JSON.stringify(value);
}
