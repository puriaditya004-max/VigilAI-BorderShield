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
npm run validation:field -- --source 0 --model yolov8n.pt --max-frames 200 --keyframe-dir reports/keyframes --report reports/field-validation.json
```

Real-source validation passes `--keyframe_dir` to the Python YOLO runtime so emitted `TrackEvent.frame.uri` values can produce non-SVG keyframe evidence. Treat PNG/keyframe evidence, face privacy metadata and plate redaction metadata as field-connected only after a real-source validation report shows non-SVG evidence with the expected redaction metadata.

The report includes explicit evidence gates:

- `nonSvgEvidenceObserved`
- `facePrivacyMetadataObserved`
- `plateRedactionMetadataObserved`
- `evidenceChecks.evidenceModes`
- `evidenceChecks.redactionTargets`

Report invariants:

- simulator/real-source producer exit code
- analytics bridge exit code
- camera registration count
- incident count
- verified evidence count
- audit count
- explicit `not_measured_without_labelled_dataset` fields for accuracy and false-alert metrics

Do not convert fixture output into accuracy claims. Precision, recall and false-alert rate must come from labelled footage.

## Production Readiness Report

Run prerequisite checks before a real-video demonstration:

```bash
npm run validation:production
```

The report checks required config files and optional real-runtime dependencies such as Python, FFmpeg, model files, ANPR detector/OCR commands, face detector commands and alert webhook configuration. It does not measure AI accuracy.
