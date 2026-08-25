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
- `GET /api/cameras`
- `GET /api/zones`
- `POST /api/incidents`
- `GET /api/incidents`
- `GET /api/audit`

Production invariants already enforced:

- camera device key required for health and incident ingest
- `IncidentEvent` and `CameraHealth` contract validation
- idempotent incident creation through `Idempotency-Key`
- append-only audit records for camera and incident events
