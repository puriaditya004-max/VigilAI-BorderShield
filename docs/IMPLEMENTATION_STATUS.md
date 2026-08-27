# VigilAI BorderShield Implementation Status

Last updated: 2026-08-26

Status legend:

- DONE: implemented, connected to the application flow, covered by automated tests, documented.
- PARTIAL: implemented as a foundation or fixture-backed path, but not fully production-ready.
- BLOCKED: requires hardware, labelled data, credentials, or external deployment infrastructure.
- NOT STARTED: no meaningful implementation yet.

## Phase 0 - Repository Audit and Test Stability

| Requirement | Status | Evidence |
|---|---|---|
| Inspect current architecture, schemas, APIs, tests and Docker setup | DONE | `README.md`, `package.json`, `packages/contracts/`, `services/control-api/`, `edge/`, `tests/`, `deploy/compose/` inspected. |
| Record implementation checklist | DONE | `docs/IMPLEMENTATION_STATUS.md` |
| Baseline test run | DONE | `npm test` passed before isolation changes on 2026-08-26. |
| Unique temporary DB/outbox/evidence dirs per test | DONE | `tests/helpers/runtime.mjs`, env vars `CONTROL_API_DATA_DIR`, `EDGE_OUTBOX_DIR`, `EVIDENCE_DIR` |
| Dynamic test ports | DONE | `getFreePort()` in `tests/helpers/runtime.mjs` |
| Await server shutdown | DONE | `stopProcess()` in `tests/helpers/runtime.mjs` |
| Single reliable verification command | DONE | `npm run verify:stable` |
| Preserve sample payload compatibility | DONE | `npm run contracts:test` |

Verification completed on 2026-08-26:

- `npm test` passed once after isolation changes.
- `npm run verify:stable` passed with `npm test` repeated 3/3 times.
- No fixed repository DB/outbox/evidence state is required by tests after Phase 0 stabilization.

## Problem Statement Coverage

| Capability | Status | Evidence |
|---|---|---|
| Human detection and tracking | PARTIAL | `edge/vision-runtime/src/track-event-adapter.mjs`, `edge/vision-runtime/python/yolo_track_runtime.py`; fixture tested, real camera pipeline supported with canonical coordinate mapping, but accuracy not measured. |
| Vehicle detection and classification | PARTIAL | Person/vehicle class mapping in `edge/vision-runtime/src/track-event-adapter.mjs`; fixture tested. |
| Face detection only by default | PARTIAL | `edge/vision-runtime/src/privacy-redaction.mjs` can consume an external/OpenCV face detector runtime for redaction-only candidates, rejects biometric identity fields, and `runTrackBridge()` attaches face detector status plus face redaction metadata to evidence when detections are present. Field-connected target metadata still requires real footage containing detectable faces. |
| Optional privacy blur | PARTIAL | `buildPrivacyRedactionPlan()` outputs face/plate blur actions with configurable detect-only mode; `applyPixelRedaction()` performs tested pixel-level blur on image buffers; bridge evidence stores face/plate redaction metadata in fixture/integration tests and exposes detector path status in field validation. Video-frame re-encoding with applied blur and real-source target detection verification are pending. |
| ANPR / number-plate OCR | PARTIAL | OpenCV plate-localizer adapter, crop-quality checks, crop-aware OCR handoff, Indian plate validation, confidence thresholding, vehicle-track temporal voting, masking and optional PaddleOCR runtime adapter exist; bridge evidence can carry plate detector status and plate redaction metadata when detections are present. Field validation with real plate footage and detector/OCR dependencies is pending. |
| Virtual-fence intrusion | DONE | `edge/analytics/src/virtual-fence.mjs`, bridge-side trajectory accumulation, `edge/analytics/config/zones.json`, tested by unit/integration/e2e including Python-style single-point streams. |
| Suspicious-activity analytics | PARTIAL | Rule foundations for loitering, repeated boundary approach, crowd formation and sudden speed change are connected to `runTrackBridge()` and enabled in the default zone config with conservative demo thresholds; covered by `tests/integration/analytics-to-control-api.mjs`. Field tuning pending. |
| Night-movement analytics | PARTIAL | Python runtime can emit frame stats and bridge feeds configured low-light movement/tamper checks into incidents; default zone enables night and tamper rules, covered by `tests/integration/analytics-to-control-api.mjs`. Camera-specific tuning pending. |
| Real-time alerting and event logging | PARTIAL | Incident/audit flow, operator-authorized SSE stream, operator lifecycle updates and optional HIGH/CRITICAL webhook notifications are implemented; full multi-channel notification escalation pending. |
| Command-and-control dashboard | PARTIAL | Static dashboard consumes live SSE incident updates, supports acknowledge/escalate actions and keeps polling fallback. Local OpenCV preview is available for manual camera-side demos; React/TypeScript HMI not implemented. |
| Existing CCTV/RTSP compatibility | PARTIAL | Python runtime accepts OpenCV sources including RTSP and maps source-frame detections into the canonical 1280x720 zone coordinate space; ONVIF discovery not implemented. |
| Offline edge operation and synchronization | PARTIAL | Durable JSON outbox and replay in `edge/edge-agent/src/outbox.mjs`; bridge startup no longer crashes if camera registration is unavailable and queues incidents until the command link recovers, covered by `tests/integration/offline-startup-queue.mjs`. Evidence encryption is optional, bounded rolling frame buffer foundation exists, encrypted rolling video buffer pending. |
| Accuracy/performance evaluation | PARTIAL | `npm run validation:field` generates fixture/real-source validation reports with explicit not-measured accuracy fields; labelled dataset and hardware still required for claims. |

## Phase 1 - Real Camera and Video Ingestion

| Requirement | Status | Evidence |
|---|---|---|
| RTSP URLs | PARTIAL | `edge/edge-agent/src/camera-source.mjs` classifies/redacts RTSP sources; `edge/vision-runtime/python/yolo_track_runtime.py` accepts RTSP through OpenCV, requests 1280x720 capture geometry, logs reported resolution and emits canonical 1280x720 coordinates. Real RTSP not tested. |
| Local video files | PARTIAL | Source classification and Python OpenCV source support exist; runtime logs actual capture resolution and canonical coordinate transform metadata; no committed real video fixture. |
| USB camera input | PARTIAL | `0`/numeric source classification and Python OpenCV source support exist; runtime requests 1280x720, logs actual webcam resolution and maps non-1280 frames into canonical zone coordinates. Hardware not tested in automation. |
| Coordinate-space normalization | DONE | `build_coordinate_transform()` and `track_event()` in `edge/vision-runtime/python/yolo_track_runtime.py` map 640x480, 1920x1080 and 1280x720 detections into canonical 1280x720 zone coordinates while preserving `sourceBbox`; covered by `tests/unit/yolo-runtime-resolution.test.mjs` and `tests/integration/non-1280-coordinate-fence.mjs`. |
| Integrated edge orchestrator | PARTIAL | `edge/orchestrator/src/edge-orchestrator.mjs` runs simulator or Python YOLO producer output through the analytics bridge with structured stderr logs and JSON stdout summary; Python mode passes `--keyframe_dir` so real producer events can include `frame.uri`; covered by `tests/unit/edge-orchestrator.test.mjs`, `tests/integration/edge-orchestrator-pipeline.mjs` and `tests/integration/orchestrator-keyframe-evidence.mjs`. Real video/RTSP execution requires external Python runtime dependencies, model files and footage. |
| Local HMI live preview | DONE | `python edge/vision-runtime/python/yolo_track_runtime.py --source 0 --preview` and `npm run edge:orchestrate -- --mode=python-yolo --source=0 --preview` show an interactive OpenCV preview with real detection boxes, configured fence lines, status text and crossing flash. Manual/demo aid only; not enabled by default and not a networked dashboard. |
| ONVIF discovery optional adapter | PARTIAL | `ONVIF` source type placeholder and URI classification exist; discovery protocol not implemented. |
| Reconnection with exponential backoff | DONE | `reconnectDelay()` in `edge/edge-agent/src/camera-source.mjs`, covered by `tests/unit/camera-source.test.mjs`. |
| Stream-health monitoring | DONE | `StreamHealthTracker` emits `CameraHealth` payloads with dropped frames and latency. |
| FPS, resolution, latency and dropped-frame metrics | PARTIAL | Dropped-frame and latency metrics implemented; Python runtime requests/logs capture resolution, emits frame brightness/contrast/sharpness/blocked-ratio metadata per detection, and the orchestrator reports runtime duration/incident summary. Measured FPS from the real decoder loop is still pending. |
| Secure camera credential handling | DONE | `redactUri()` prevents RTSP credentials in health payloads/loggable values, and camera configs can use `streamUriRef` with `env:` or `file:` secret references; covered by `tests/unit/camera-source.test.mjs`. |
| Configurable frame sampling | DONE | `frameSampling.targetFps` and `maxDecodeFps` validated in camera source config. |
| CPU and NVIDIA GPU execution modes | PARTIAL | Runtime config supports `CPU`/future modes; GPU execution not tested. |

## Phase 2 - Analytics Rules Foundation

| Requirement | Status | Evidence |
|---|---|---|
| ANPR text normalization | DONE | `normalizePlateText()` in `edge/analytics/src/anpr.mjs`, covered by `tests/unit/anpr.test.mjs`. |
| Plate-format validation | DONE | Indian registration pattern validation in `isValidIndianPlate()`. |
| Temporal voting for ANPR | DONE | `votePlateCandidates()` requires repeated valid candidates above configurable confidence before accepting a plate. |
| Plate detector and crop quality for ANPR | PARTIAL | `detectPlateCandidates()`, `buildPlateDetection()` and `assessPlateCropQuality()` provide a detector interface and deterministic crop rejection reasons; `edge/analytics/python/opencv_plate_detector.py` provides a first OpenCV candidate localizer. Covered by `tests/unit/anpr.test.mjs` and `tests/unit/python-runtime-cli.test.mjs` when Python/OpenCV is installed. Real detector model assets and labelled accuracy remain pending. |
| OCR/model integration for ANPR | PARTIAL | `ocrPlateImage()` consumes runtime JSON from `ANPR_OCR_COMMAND`; `processVehicleAnprFrame()` combines detected plate crops or detector-provided crop paths with OCR candidates and per-vehicle temporal voting. `tests/integration/anpr-bridge-flow.mjs` verifies masked ANPR incident/evidence publication through the bridge using deterministic detector/OCR fixtures. Requires installed OCR/detector dependencies and field validation. |
| Loitering detection | PARTIAL | `detectLoitering()` uses configurable dwell threshold and polygon containment and is connected to bridge incident publishing; default zone config enables it for field demos. |
| Repeated boundary approach | PARTIAL | `detectRepeatedBoundaryApproach()` uses configurable distance/count thresholds and is connected to bridge incident publishing; default zone config enables it for field demos. |
| Crowd formation | PARTIAL | `detectCrowdFormation()` counts tracked objects inside a configured polygon and is connected to bridge incident publishing; default zone config enables it for field demos. |
| Sudden speed-change detection | PARTIAL | `detectSuddenSpeedChange()` uses pixel-speed ratio, is connected to bridge incident publishing, default zone config enables it, and it explicitly flags calibration requirement for world-speed claims. |
| Virtual-fence object filters | DONE | `objectClasses` filter and `OBJECT_CLASS_NOT_MONITORED` decision reason in `edge/analytics/src/virtual-fence.mjs`. |
| Virtual-fence active schedule | DONE | Optional UTC schedule evaluator in `isZoneActive()`. |
| Virtual-fence duplicate cooldown | DONE | `FenceIncidentPolicy` suppresses duplicate alerts with `DUPLICATE_COOLDOWN_ACTIVE`. |
| Decision reason codes | DONE | Rule outcomes include deterministic reason codes; incident reason codes include `ZONE_POLICY_MATCHED` when policy passes. |

## Phase 2A - Real-Producer Bridge Compatibility

| Requirement | Status | Evidence |
|---|---|---|
| Python-style single-point TrackEvent accumulation | DONE | `accumulateTrackTrajectory()` in `edge/analytics/src/track-bridge.mjs` stores per-camera/track history and caps it to `TRACK_TRAJECTORY_HISTORY_POINTS`. |
| Preserve already-accumulated simulated trajectories | DONE | Accumulation deduplicates points by x/y/t so fixture multi-point trajectories are not corrupted. |
| Real-producer fence crossing regression test | DONE | `tests/integration/python-style-track-stream.mjs` sends one footpoint per event and asserts a virtual-fence incident is created. |

## Phase 3 - Privacy and Night Operations Foundation

| Requirement | Status | Evidence |
|---|---|---|
| Face detection without identity recognition | PARTIAL | `buildFaceCandidate()` emits `identityRecognition: false`; `detectFaceCandidatesFromImage()` consumes face detector JSON for redaction-only candidates, and `tests/integration/night-face-privacy-flow.mjs` plus `tests/integration/privacy-redaction-bridge-flow.mjs` verify bridge-side face metadata on evidence; no recognition/matching path exists. |
| Block biometric identity fields | DONE | `assertNoBiometricIdentityFields()` rejects `personId`, names, embeddings and match identifiers. |
| Face privacy redaction plan | DONE | `buildPrivacyRedactionPlan()` creates bounded face blur targets and supports detect-only mode. |
| Number-plate redaction plan | DONE | Same privacy plan supports plate blur targets separate from ANPR voting; accepted ANPR detections and privacy plate-detector results attach plate redaction metadata to evidence manifests. |
| Pixel-level blur renderer | PARTIAL | `applyPixelRedaction()` changes protected image-buffer pixels while preserving unrelated regions; covered by `tests/unit/privacy-redaction.test.mjs`. JPEG/MP4 frame IO integration pending. |
| Low-light quality assessment | DONE | `assessLowLightQuality()` evaluates brightness/contrast against configurable thresholds. |
| Night movement rule | PARTIAL | `detectNightMovement()` combines low-light quality and zone presence and can publish bridge incidents from frame analysis metadata; default zone config enables it and `tests/integration/night-face-privacy-flow.mjs` verifies night movement plus privacy evidence wiring. Field calibration pending. |
| Camera tamper rule | PARTIAL | `detectFrameTamper()` covers signal loss, occlusion, blackout and blur/defocus heuristics and can publish bridge incidents from frame analysis metadata; default zone config enables it for field demos. |
| Rule-to-incident mapping | DONE | `edge/analytics/src/incident-builder.mjs` maps night and suspicious decisions to `incident-event.v1`, covered by contract validation. |

## Phase 4 - Realtime API and Security Hardening

| Requirement | Status | Evidence |
|---|---|---|
| Realtime incident delivery | DONE | `GET /api/events` emits operator-authorized Server-Sent Events; `tests/integration/realtime-events.mjs` verifies incident delivery. |
| Dashboard live updates | DONE | `apps/command-ui/public/main.js` consumes the SSE stream through authenticated fetch streaming with polling fallback. |
| Security headers | DONE | `withSecurityHeaders()` applies `nosniff`, frame denial, no-referrer and resource policy to JSON/static/SSE responses. |
| Request body size limits | DONE | `readJsonBody()` enforces configurable `MAX_JSON_BODY_BYTES` and returns 413 on oversized payloads. |
| Invalid JSON handling | DONE | Invalid request JSON returns 400; covered by `tests/integration/control-api-hardening.mjs`. |
| Sensitive read API authorization | DONE | Incident, evidence-manifest, audit, metrics and realtime event read endpoints require operator `incident:read` permission; dashboard fetches include operator headers. |
| API rate limiting | PARTIAL | In-memory per-client limiter in `services/control-api/src/security.mjs`; production distributed store pending. |
| Hashed device-key storage | DONE | New/rotated camera keys are stored as SHA-256 hashes; plaintext key is returned only on issuance. |
| Public camera response redaction | DONE | `GET /api/cameras` removes `deviceKey` and `deviceKeyHash` fields. |
| Operator auth and RBAC | PARTIAL | Header/token-based operator foundation with VIEWER/OPERATOR/COMMANDER permissions; persistent login/session UI pending. |
| TLS or mTLS enforcement | BLOCKED | Requires deployment certificates and reverse proxy/runtime configuration. |

## Phase 5 - Operator Incident Workflow

| Requirement | Status | Evidence |
|---|---|---|
| Operator identity on actions | DONE | `authenticateOperator()` requires `x-operator-id` and records actor in audit events. |
| Role-based permissions | DONE | VIEWER, OPERATOR and COMMANDER permissions in `services/control-api/src/security.mjs`, covered by `tests/unit/control-api-security.test.mjs`. |
| Optional operator bearer token | PARTIAL | `OPERATOR_TOKEN` enforces bearer token when configured; full login/session issuance pending. |
| Incident acknowledgement | DONE | `POST /api/incidents/:incidentId/acknowledge` sets status, actor, timestamp and audit entry. |
| Incident escalation | DONE | `POST /api/incidents/:incidentId/escalate` sets status, target, actor, timestamp and audit entry. |
| Lifecycle realtime events | DONE | Acknowledge/escalate actions publish SSE events consumed by the dashboard. |
| Dashboard command actions | DONE | Incident cards show acknowledge/escalate buttons for open incidents. |
| Alert webhook delivery | DONE | `ALERT_WEBHOOK_URL` sends HIGH/CRITICAL incident and commander-escalation notifications with bearer-token support and delivered/failed audit entries; covered by `tests/unit/notifier.test.mjs` and `tests/integration/notification-webhook.mjs`. |
| Human-in-the-loop critical alert handling | DONE | Critical incidents can be acknowledged/escalated by operators; configurable SLA deadlines expose overdue/due-soon incidents through API, metrics and dashboard, covered by `tests/unit/sla.test.mjs` and `tests/integration/incident-sla.mjs`. |

## Phase 6 - Evidence Lifecycle and Deployment Readiness

| Requirement | Status | Evidence |
|---|---|---|
| Evidence encryption at rest | PARTIAL | `EVIDENCE_ENCRYPTION_KEY` enables AES-256-GCM encrypted generated evidence artifacts in `edge/analytics/src/evidence.mjs`; object-store/KMS integration pending. |
| Encrypted evidence verification | DONE | Hash verification covers encrypted artifacts; `tests/integration/encrypted-evidence.mjs` decrypts and verifies generated evidence. |
| Evidence retention policy | DONE | `expireEvidenceManifests()` marks old manifests `EXPIRED` and can delete local assets. |
| Retention API | DONE | `POST /api/evidence/retention/run` requires COMMANDER permission and writes audit event. |
| Retention CLI | DONE | `npm run evidence:retention` runs cleanup for scheduled jobs. |
| Authorized evidence asset serving | DONE | `GET /api/evidence/assets/:manifestId/:assetIndex` requires operator read permission, only serves verified manifests under `EVIDENCE_DIR`, rechecks asset hashes, and is covered by `tests/integration/evidence-asset-serving.mjs`; manifest list responses expose safe asset URLs instead of raw `file://` paths. |
| Production env template | DONE | `.env.example` documents runtime, security, rate limit and evidence lifecycle settings without secrets. |
| Compose healthcheck | DONE | `deploy/compose/compose.yaml` waits for `control-api` health before starting `edge-bridge`. |
| Deployment runbook | DONE | `docs/runbooks/README.md` documents smoke tests, operator workflow and retention procedure. |
| Production TLS/mTLS | BLOCKED | Requires deployment gateway/certificates. |

## Phase 7 - Validation and Promotion Readiness

| Requirement | Status | Evidence |
|---|---|---|
| Repeatable field validation harness | DONE | `tests/performance/field-validation.mjs` runs the producer-to-bridge-to-API path and writes a JSON report with evidence gates for non-SVG evidence, detector path connection and observed face/plate redaction metadata. |
| Real-source validation command | DONE | `npm run validation:field -- --source <camera|rtsp|video> --model <model> --keyframe-dir <dir>` is documented and passes `--keyframe_dir` into the Python runtime. |
| Accuracy claim guardrails | DONE | Validation report keeps precision, recall and false-alert rate as `not_measured_without_labelled_dataset` until labelled data is supplied. |
| Dataset manifest template | DONE | `ml/datasets/README.md` documents slices, privacy fields and label counts. |
| Model promotion template | DONE | `ml/model-registry/README.md` documents model card, checksum, metrics and rollback gate. |
| Production model promotion | BLOCKED | Requires real model artifacts, labelled validation footage and approval. |

## Phase 8 - OCR and Face Runtime Adapters

| Requirement | Status | Evidence |
|---|---|---|
| ANPR OCR command adapter | DONE | `ocrPlateImage()` runs a configured JSON OCR command and feeds text into normalization/validation/voting. |
| PaddleOCR wrapper | PARTIAL | `edge/analytics/python/paddleocr_plate_runtime.py` emits OCR JSON when PaddleOCR dependencies are installed; no committed model output fixture is treated as accuracy. |
| Face detector command adapter | DONE | `detectFaceCandidatesFromImage()` runs a configured detector command and converts detections into privacy redaction candidates. |
| OpenCV face detector wrapper | PARTIAL | `edge/vision-runtime/python/opencv_face_runtime.py` emits face boxes using OpenCV Haar cascade when installed, logs diagnosable stderr on runtime failures, and is covered by `tests/unit/python-runtime-cli.test.mjs` when Python/OpenCV is installed; redaction-only, no recognition. |
| Adapter tests | DONE | Unit tests use mock JSON runtime commands for ANPR and face detection parsing. |

## Implemented Foundation

| Area | Status | Evidence |
|---|---|---|
| JSON contracts and samples | DONE | `packages/contracts/schemas/`, `packages/contracts/samples/`, `tests/contract/validate-samples.mjs` |
| Camera registration | DONE | `POST /api/cameras/register` in `services/control-api/src/server.mjs` |
| Device-key auth and rotation | DONE | `POST /api/cameras/rotate-key`, `tests/integration/device-key-rotation.mjs` |
| Camera health events | DONE | `POST /api/cameras/health`, `camera-health.v1` |
| Incident ingestion | DONE | `POST /api/incidents`, `incident-event.v1` |
| Evidence manifests and hash verification | DONE | `services/evidence-service/src/manifest.mjs`, `POST /api/evidence/manifests` |
| Visual evidence fixture | DONE | SVG keyframe generation in `edge/analytics/src/evidence.mjs` |
| Real PNG keyframe evidence | PARTIAL | `createPngEvidence()` writes hash-verified PNG keyframes with bbox/zone/trajectory overlays and redaction metadata; covered by `tests/unit/evidence-service.test.mjs`. Producer `frame.uri` events use copied/hash-verified source frame evidence through `createEvidenceForTrack()`, and orchestrator keyframe pass-through is covered by `tests/integration/orchestrator-keyframe-evidence.mjs`. Real-source field validation has produced non-SVG evidence, but field target metadata still depends on actual detections. |
| Evidence redaction metadata | DONE | Evidence manifests can carry redaction actions in `metadata.redactions`; covered by `tests/unit/evidence-service.test.mjs`. |
| Rolling frame buffer | PARTIAL | `RollingFrameBuffer` in `edge/analytics/src/media-buffer.mjs` keeps bounded per-camera frame history and can select pre/post event windows; `runTrackBridge()` now buffers real `frame.uri` keyframes for clip evidence. Covered by `tests/unit/media-buffer.test.mjs` and `tests/integration/mp4-clip-evidence-flow.mjs`. Real decoder frame density remains limited to producer keyframes. |
| Safe FFmpeg clip adapter | PARTIAL | `buildFfmpegImageSequenceArgs()`, `runFfmpegClip()` and `createMp4ClipEvidence()` use argument arrays for MP4 clip creation and produce hash-verified clip manifests when FFmpeg succeeds; bridge evidence now records `clipStatus` plus reason codes for insufficient frames or FFmpeg failures. Covered by `tests/unit/media-buffer.test.mjs`, `tests/unit/evidence-service.test.mjs` and `tests/integration/mp4-clip-evidence-flow.mjs`. Live FFmpeg field verification still requires an installed `ffmpeg` binary. |
| Metrics endpoint | DONE | `GET /api/metrics` |
| Audit log | DONE | append-only audit entries in `services/control-api/src/store.mjs` |
| Split vision-to-analytics bridge | DONE | `edge/vision-runtime/src/simulate-tracks.mjs`, `edge/analytics/src/track-bridge.mjs` |
| Edge pipeline orchestrator | PARTIAL | `edge/orchestrator/` supervises simulator or Python YOLO producer, routes JSON events through `runTrackBridge()` into the control API, and can pass `--preview` for manual local-HMI demos. |
| Integrated analytics bridge | PARTIAL | `runTrackBridge()` now evaluates configured virtual-fence, suspicious-activity, night movement, camera-tamper, ANPR and face/plate-redaction metadata rules against accumulated track/frame metadata and publishes accepted incidents/evidence through the same Control API/outbox path. Default zone privacy config enables face and plate detector metadata for real demo runs when detector commands are configured. |
| ANPR rule foundation | PARTIAL | `edge/analytics/src/anpr.mjs`; plate detector adapter, crop quality, crop-aware OCR handoff, masking, OCR command adapter and vehicle-track temporal voting are test-covered. Real detector/OCR accuracy remains not measured. |
| Suspicious-activity rule foundation | PARTIAL | `edge/analytics/src/suspicious-activity.mjs`; default zone wiring present, real-world tuning pending. |
| Virtual-fence policy hardening | DONE | `FenceIncidentPolicy`, class filters, active schedule and cooldown in `edge/analytics/src/virtual-fence.mjs`. |
| Privacy redaction foundation | PARTIAL | `edge/vision-runtime/src/privacy-redaction.mjs`; optional face detector command adapter and bridge-side plate detector metadata path present, no identity recognition or embeddings. |
| Night/tamper analytics foundation | PARTIAL | `edge/analytics/src/night-watch.mjs`; deterministic rules, not field-calibrated claims. |
| Analytics incident builder | DONE | `edge/analytics/src/incident-builder.mjs` validates generated night/suspicious incidents against contract. |
| Realtime incident stream | DONE | SSE stream in `services/control-api/src/server.mjs`; dashboard subscribes through `EventSource`. |
| API security helpers | PARTIAL | `services/control-api/src/security.mjs` covers hashed device keys, in-memory rate limits and operator RBAC foundation. |
| Incident acknowledgement workflow | DONE | API/UI support acknowledge and escalate actions with audit trail and SSE refresh. |
| Alert notification workflow | DONE | Optional webhook notifier in `services/control-api/src/notifier.mjs` delivers incident/escalation alerts and records notification audit events. |
| Incident SLA workflow | DONE | `services/control-api/src/sla.mjs` computes severity-based deadlines from `INCIDENT_SLA_MINUTES`; `GET /api/incidents/sla`, metrics and dashboard show overdue incidents. |
| Evidence lifecycle controls | DONE | Optional encryption plus API/CLI retention cleanup with audit trail. |
| Safe evidence dashboard access | DONE | Command UI opens evidence artifacts through the authorized asset endpoint instead of exposing raw filesystem paths. |
| Docker Compose development path | PARTIAL | `deploy/compose/compose.yaml` includes env-file and healthcheck; production gateway/TLS still pending. |
| Field validation harness | DONE | `npm run validation:field` produces auditable JSON report for fixture or real source, including evidence-mode, redaction-metadata gates and optional suspicious/night/MP4 observation flags for field demo verification. |
| Production readiness check | DONE | `npm run validation:production` writes a JSON report for required config and optional real-runtime blockers such as Python, FFmpeg, model files and detector/OCR commands. |
| Model/dataset promotion guardrails | DONE | Dataset and model registry templates prevent unsupported accuracy claims. |
| Real-producer trajectory compatibility | DONE | Bridge accumulates incoming single-point trajectories so real YOLO runtime can trigger fence policy. |
| Optional OCR/face runtime adapters | PARTIAL | PaddleOCR/OpenCV wrappers and Node command adapters exist; ANPR also has an OpenCV plate-detector command seam with default env template entries. Dependencies and field data must be supplied externally. |
| Python runtime dependency pinning | DONE | `edge/vision-runtime/python/requirements.txt` pins `opencv-python` and `ultralytics` for the real YOLO runtime. |

## Current Verification Commands

```bash
npm test
npm run verify:stable
npm run validation:field
npm run validation:production
```

## Known Security and Privacy Limitations

- New and rotated device keys are hashed in local JSON; existing legacy plaintext keys are accepted only for backward compatibility until rotation.
- Operator RBAC protects incident actions plus sensitive incident/evidence/audit/metrics reads, but there is no persistent login/session UI, MFA, or TLS/mTLS enforcement yet.
- Rate limiting is in-memory and single-process only; production should use a shared limiter behind the deployment gateway.
- Camera source configs support env/file secret references for RTSP URIs; avoid committing raw camera credentials.
- Face detection has a privacy-only candidate/redaction foundation and optional detector adapter; no identity recognition, matching or biometric embeddings are implemented.
- ANPR has detector/crop/voting foundations and optional OCR adapter paths; no measured OCR or plate-detection accuracy is claimed.
- Privacy redaction currently emits blur instructions; production video/image blur rendering still needs frame pipeline integration.
- Evidence encryption, retention, and authorized local asset serving exist for filesystem artifacts; production object storage/KMS integration is still pending.
- No measured accuracy, false-alert rate, or camera capacity should be claimed.

## Next Highest-Priority Phase

Next priority requires external inputs: real RTSP/USB camera footage, ANPR/face model assets, labelled validation data and deployment certificates for TLS/mTLS. Without those, no further accuracy or field-readiness claims should be made.
