# control-api

Cameras, zones, incidents, users, audit.
Typed API, OIDC/RBAC, C2 adapter.
Stack: NestJS, TypeScript, Prisma/OpenAPI, Keycloak.

Current foundation is a dependency-free Node.js service so contracts can run before database/framework choices are finalized.

Run:

```bash
npm run control-api:start
```

Endpoints:

- `GET /health`
- `POST /api/cameras/register`
- `POST /api/cameras/health`
- `POST /api/cameras/rotate-key`
- `GET /api/cameras`
- `GET /api/zones`
- `POST /api/incidents`
- `GET /api/incidents`
- `POST /api/evidence/manifests`
- `GET /api/evidence/manifests`
- `GET /api/audit`
- `GET /api/metrics`

Production invariants already enforced:

- camera device key required for health and incident ingest
- camera device key rotation with audit
- `IncidentEvent` and `CameraHealth` contract validation
- `EvidenceManifest` contract and local hash verification
- idempotent incident creation through `Idempotency-Key`
- append-only audit records for camera and incident events
