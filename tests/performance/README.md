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
FACE_DETECT_COMMAND=python
FACE_DETECT_ARGS="edge/vision-runtime/python/opencv_face_runtime.py --image {imagePath}"
# Set ANPR_PLATE_DETECT_COMMAND / ANPR_PLATE_DETECT_ARGS to an approved plate detector before claiming plate metadata.
npm run validation:field -- --source 0 --model yolov8n.pt --max-frames 200 --keyframe-dir reports/keyframes --report reports/field-validation.json
```

Real-source validation passes `--keyframe_dir` to the Python YOLO runtime so emitted `TrackEvent.frame.uri` values can produce non-SVG keyframe evidence. Treat PNG/keyframe evidence as field-connected after a real-source validation report shows non-SVG evidence. Treat face and plate target metadata as field-connected only after the report shows the detector path connected and the captured frames contain actual detectable faces or plates.

The report includes explicit evidence gates:

- `nonSvgEvidenceObserved`
- `facePrivacyMetadataObserved`
- `facePrivacyPathConnected`
- `plateRedactionMetadataObserved`
- `platePrivacyPathConnected`
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

## Field-Test Every Analytics Path

Use the optional report flags during a real-source run:

```bash
npm run validation:field -- --source 0 --model yolov8n.pt --max-frames 400 --keyframe-dir reports/keyframes --report reports/field-validation.json --check-suspicious-activity --check-night-watch --check-mp4-clip
```

Operator actions during the run:

- Walk fully across the virtual fence line to verify intrusion incidents.
- Stand still inside the monitored area to give loitering a chance to fire if configured.
- Approach the boundary repeatedly or move quickly across the frame to exercise boundary-approach and speed-change rules if configured.
- Cover the lens briefly or run in a genuinely low-light scene to exercise night/tamper rules if configured.
- Keep the subject visible for several frames so MP4 clip buffering has enough pre/post-event frames.

The flags only report what was observed in the run. They do not force detections, fabricate incidents, or create accuracy claims.

## Offline Replay Drill

See `docs/runbooks/offline-replay-demo.md` for the manual command-link loss drill: start the API, run the real camera pipeline, stop the API mid-run, confirm outbox queueing, restart the API, and verify replayed incidents through the operator read APIs.
