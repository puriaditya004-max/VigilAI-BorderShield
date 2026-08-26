# performance tests

FPS, latency, capacity and soak tests.

Next measurable gates:

- `vision_fps`: frames processed per second per camera source
- `incident_latency_ms`: capture time to control API acceptance
- `outbox_replay_ms`: queued incident replay duration after command link recovery
- `api_p95_ms`: control API P95 response time under expected camera count

The current suite proves correctness first; performance benchmarks should be added once real video/RTSP sources are connected.

## Field Validation Report

Run the fixture-backed validation report:

```bash
npm run validation:field
```

Run against a real source after installing the Python runtime dependencies:

```bash
npm run validation:field -- --source 0 --model yolov8n.pt --max-frames 200 --report reports/field-validation.json
```

Report invariants:

- simulator/real-source producer exit code
- analytics bridge exit code
- camera registration count
- incident count
- verified evidence count
- audit count
- explicit `not_measured_without_labelled_dataset` fields for accuracy and false-alert metrics

Do not convert fixture output into accuracy claims. Precision, recall and false-alert rate must come from labelled footage.
