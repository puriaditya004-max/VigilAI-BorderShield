CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cameras (
  camera_id text PRIMARY KEY,
  name text NOT NULL,
  edge_node_id text NOT NULL,
  location text NOT NULL DEFAULT 'unknown',
  stream_uri text,
  device_key_hash text,
  status text NOT NULL DEFAULT 'ONLINE',
  registered_at timestamptz,
  last_heartbeat timestamptz,
  key_rotated_at timestamptz,
  last_quality jsonb,
  last_stream jsonb,
  record jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS zones (
  zone_id text PRIMARY KEY,
  camera_id text NOT NULL,
  name text NOT NULL,
  line jsonb,
  polygon jsonb,
  direction text,
  severity text,
  enabled boolean,
  schedule jsonb,
  analytics jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  record jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT zones_camera_id_fkey
    FOREIGN KEY (camera_id) REFERENCES cameras(camera_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS incidents (
  event_id text PRIMARY KEY,
  incident_id text NOT NULL UNIQUE,
  camera_id text NOT NULL,
  zone_id text NOT NULL,
  type text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  capture_time timestamptz NOT NULL,
  received_at timestamptz,
  idempotency_key text UNIQUE,
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledgement_note text,
  escalated_at timestamptz,
  escalated_by text,
  escalation_target text,
  escalation_note text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  record jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT incidents_camera_id_fkey
    FOREIGN KEY (camera_id) REFERENCES cameras(camera_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS evidence_manifests (
  manifest_id text PRIMARY KEY,
  incident_id text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL,
  received_at timestamptz,
  status text NOT NULL DEFAULT 'VERIFIED',
  sha256 text NOT NULL,
  keyframe_uri text,
  clip_uri text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  record jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT evidence_manifests_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS evidence_assets (
  manifest_id text NOT NULL REFERENCES evidence_manifests(manifest_id) ON DELETE CASCADE,
  asset_index integer NOT NULL,
  kind text NOT NULL,
  uri text NOT NULL,
  sha256 text NOT NULL,
  content_type text,
  record jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (manifest_id, asset_index)
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id text PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL,
  record jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_incidents_camera_id ON incidents(camera_id);
CREATE INDEX IF NOT EXISTS idx_incidents_capture_time_desc ON incidents(capture_time DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_received_at_desc ON incidents(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at_desc ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_manifests_incident_id ON evidence_manifests(incident_id);
