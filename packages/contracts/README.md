# contracts

Shared event/data contracts: CameraHealth, TrackEvent, IntrusionEvent, PlateCandidate, FaceCandidate, IncidentEvent.
Protobuf for internal gRPC; JSON Schema/OpenAPI at external boundaries.

Current executable v1 contracts:

- `camera-health.v1`
- `track-event.v1`
- `incident-event.v1`
- `evidence-manifest.v1`
- `audit-event.v1`

Run:

```bash
npm run contracts:test
```

The schemas are strict by design: explicit `schemaVersion`, stable IDs, no undeclared fields, and evidence hashes on incident/evidence records.
