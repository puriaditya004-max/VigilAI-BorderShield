# PostgreSQL Storage Migration

The production storage path is opt-in. The SIH/demo default remains the JSON-file store:

```bash
STORE_DRIVER=json
```

Use PostgreSQL only when a local or deployed Postgres instance is ready and migrations have run.

## Local Postgres

```bash
docker compose -f deploy/compose/compose.yaml up -d postgres
$env:POSTGRES_URL="postgres://vigilai:vigilai@localhost:5433/vigilai"
npm run db:migrate
```

The same URL can also be supplied as `DATABASE_URL`.

## Switch The API

```bash
$env:STORE_DRIVER="postgres"
$env:POSTGRES_URL="postgres://vigilai:vigilai@localhost:5433/vigilai"
npm run control-api:start
```

No API route or response shape changes when the driver is switched. The storage selector keeps JSON as the fallback when `STORE_DRIVER` is unset.

## Import Existing JSON Data

Run migrations first, then import the current JSON store:

```bash
npm run db:import-json -- services/control-api/data/control-api.db.json
```

The importer preserves the existing in-memory shape: `cameras`, `zones`, `incidents`, `evidence`, and `audits`. Evidence assets are also copied into the normalized `evidence_assets` child table for asset-serving queries.

The schema keeps incidents linked to cameras and evidence manifests linked to incidents. Zones keep `camera_id` as indexed text without a hard foreign key because the current JSON default contains zone policy before a camera has registered.

## Verification

JSON fallback:

```bash
npm test
```

PostgreSQL smoke test:

```bash
$env:POSTGRES_URL="postgres://vigilai:vigilai@localhost:5433/vigilai"
npm run postgres:test
```

The Postgres smoke test creates a temporary schema, runs migrations, starts the Control API with `STORE_DRIVER=postgres`, registers a camera, creates an incident, writes an evidence manifest, verifies audit persistence, and drops the schema afterward.

## Current Status

PostgreSQL support is PARTIAL until the smoke test is run against an actual Postgres instance in the target environment. JSON mode remains the SIH real-demo path unless Postgres is explicitly enabled and verified before the demo.
