# compose

Docker Compose manifests for SIH demo / single-post pilot deployment (2-3 containers, not twelve).

Current Compose file runs the dependency-free control API:

```bash
copy .env.example .env
docker compose -f deploy/compose/compose.yaml up
```

The service stores local development state under `services/control-api/data/`, which is ignored by git.

The Compose stack also includes an optional PostgreSQL service for storage-migration testing. It maps to host port `5433` by default so it can run beside other SIH projects using `5432`.

```bash
docker compose -f deploy/compose/compose.yaml up -d postgres
$env:POSTGRES_URL="postgres://vigilai:vigilai@localhost:5433/vigilai"
npm run db:migrate
```

Production notes:

- set `DEVICE_KEY_SALT`, `OPERATOR_TOKEN` and `EVIDENCE_ENCRYPTION_KEY` before running outside local demo mode
- keep `.env` out of git
- expose the control API behind TLS/mTLS at the site gateway
- run `npm run evidence:retention` from a scheduled job if the API retention endpoint is not used
- replace the simulator command in `edge-bridge` with the real RTSP/USB runtime for field testing
