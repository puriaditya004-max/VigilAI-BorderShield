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
| Human detection and tracking | PARTIAL | `edge/vision-runtime/src/track-event-adapter.mjs`, `edge/vision-runtime/python/yolo_track_runtime.py`; fixture tested, real camera not yet measured. |
| Vehicle detection and classification | PARTIAL | Person/vehicle class mapping in `edge/vision-runtime/src/track-event-adapter.mjs`; fixture tested. |
| Face detection only by default | PARTIAL | `edge/vision-runtime/src/privacy-redaction.mjs` builds face candidates for redaction only and rejects biometric identity fields; detector integration pending. |
| Optional privacy blur | PARTIAL | `buildPrivacyRedactionPlan()` outputs face/plate blur actions with configurable detect-only mode; evidence artifacts can be encrypted; pixel-level media transform integration pending. |
| ANPR / number-plate OCR | PARTIAL | Normalization, Indian plate-format validation, confidence thresholding and temporal voting foundation in `edge/analytics/src/anpr.mjs`; OCR detector integration pending. |
| Virtual-fence intrusion | DONE | `edge/analytics/src/virtual-fence.mjs`, `edge/analytics/config/zones.json`, tested by unit/integration/e2e. |
| Suspicious-activity analytics | PARTIAL | Rule foundations for loitering, repeated boundary approach, crowd formation and sudden speed change in `edge/analytics/src/suspicious-activity.mjs`; no measured field tuning yet. |
| Night-movement analytics | PARTIAL | Low-light quality assessment, night movement rule and tamper rules in `edge/analytics/src/night-watch.mjs`; camera-specific tuning pending. |
| Real-time alerting and event logging | PARTIAL | Incident/audit flow plus SSE incident stream and operator lifecycle updates; full notification escalation pending. |
| Command-and-control dashboard | PARTIAL | Static dashboard consumes live SSE incident updates, supports acknowledge/escalate actions and keeps polling fallback; React/TypeScript HMI not implemented. |
| Existing CCTV/RTSP compatibility | PARTIAL | Python runtime accepts OpenCV sources including RTSP; ONVIF discovery not implemented. |
| Offline edge operation and synchronization | PARTIAL | Durable JSON outbox and replay in `edge/edge-agent/src/outbox.mjs`; evidence encryption is optional, encrypted rolling video buffer pending. |
| Accuracy/performance evaluation | BLOCKED | Labelled dataset and measured hardware unavailable; no accuracy claims made. |

## Phase 1 - Real Camera and Video Ingestion

| Requirement | Status | Evidence |
|---|---|---|
| RTSP URLs | PARTIAL | `edge/edge-agent/src/camera-source.mjs` classifies/redacts RTSP sources; `edge/vision-runtime/python/yolo_track_runtime.py` accepts RTSP through OpenCV. Real RTSP not tested. |
| Local video files | PARTIAL | Source classification and Python OpenCV source support exist; no committed real video fixture. |
| USB camera input | PARTIAL | `0`/numeric source classification and Python OpenCV source support exist; hardware not tested in automation. |
| ONVIF discovery optional adapter | PARTIAL | `ONVIF` source type placeholder and URI classification exist; discovery protocol not implemented. |
| Reconnection with exponential backoff | DONE | `reconnectDelay()` in `edge/edge-agent/src/camera-source.mjs`, covered by `tests/unit/camera-source.test.mjs`. |
| Stream-health monitoring | DONE | `StreamHealthTracker` emits `CameraHealth` payloads with dropped frames and latency. |
| FPS, resolution, latency and dropped-frame metrics | PARTIAL | Dropped-frame and latency metrics implemented; resolution and measured FPS are pending real frame reader integration. |
| Secure camera credential handling | PARTIAL | `redactUri()` prevents RTSP credentials in health payloads/loggable values; secret reference loading pending. |
| Configurable frame sampling | DONE | `frameSampling.targetFps` and `maxDecodeFps` validated in camera source config. |
| CPU and NVIDIA GPU execution modes | PARTIAL | Runtime config supports `CPU`/future modes; GPU execution not tested. |

## Phase 2 - Analytics Rules Foundation

| Requirement | Status | Evidence |
|---|---|---|
| ANPR text normalization | DONE | `normalizePlateText()` in `edge/analytics/src/anpr.mjs`, covered by `tests/unit/anpr.test.mjs`. |
| Plate-format validation | DONE | Indian registration pattern validation in `isValidIndianPlate()`. |
| Temporal voting for ANPR | DONE | `votePlateCandidates()` requires repeated valid candidates above configurable confidence before accepting a plate. |
| OCR/model integration for ANPR | BLOCKED | Requires detector/OCR model assets or camera footage; no fake plate accuracy claimed. |
| Loitering detection | PARTIAL | `detectLoitering()` uses configurable dwell threshold and polygon containment. |
| Repeated boundary approach | PARTIAL | `detectRepeatedBoundaryApproach()` uses configurable distance and count thresholds. |
| Crowd formation | PARTIAL | `detectCrowdFormation()` counts tracked objects inside a configured polygon. |
| Sudden speed-change detection | PARTIAL | `detectSuddenSpeedChange()` uses pixel-speed ratio and explicitly flags calibration requirement for world-speed claims. |
| Virtual-fence object filters | DONE | `objectClasses` filter and `OBJECT_CLASS_NOT_MONITORED` decision reason in `edge/analytics/src/virtual-fence.mjs`. |
| Virtual-fence active schedule | DONE | Optional UTC schedule evaluator in `isZoneActive()`. |
| Virtual-fence duplicate cooldown | DONE | `FenceIncidentPolicy` suppresses duplicate alerts with `DUPLICATE_COOLDOWN_ACTIVE`. |
| Decision reason codes | DONE | Rule outcomes include deterministic reason codes; incident reason codes include `ZONE_POLICY_MATCHED` when policy passes. |

## Phase 3 - Privacy and Night Operations Foundation

| Requirement | Status | Evidence |
|---|---|---|
| Face detection without identity recognition | PARTIAL | `buildFaceCandidate()` emits `identityRecognition: false` and reason `IDENTITY_RECOGNITION_DISABLED`; no recognition/matching path exists. |
| Block biometric identity fields | DONE | `assertNoBiometricIdentityFields()` rejects `personId`, names, embeddings and match identifiers. |
| Face privacy redaction plan | DONE | `buildPrivacyRedactionPlan()` creates bounded face blur targets and supports detect-only mode. |
| Number-plate redaction plan | DONE | Same privacy plan supports plate blur targets separate from ANPR voting. |
| Pixel-level blur renderer | NOT STARTED | Requires image/video frame IO integration; current module produces auditable redaction instructions only. |
| Low-light quality assessment | DONE | `assessLowLightQuality()` evaluates brightness/contrast against configurable thresholds. |
| Night movement rule | PARTIAL | `detectNightMovement()` combines low-light quality and zone presence; field calibration pending. |
| Camera tamper rule | PARTIAL | `detectFrameTamper()` covers signal loss, occlusion, blackout and blur/defocus heuristics. |
| Rule-to-incident mapping | DONE | `edge/analytics/src/incident-builder.mjs` maps night and suspicious decisions to `incident-event.v1`, covered by contract validation. |

## Phase 4 - Realtime API and Security Hardening

| Requirement | Status | Evidence |
|---|---|---|
| Realtime incident delivery | DONE | `GET /api/events` emits Server-Sent Events; `tests/integration/realtime-events.mjs` verifies incident delivery. |
| Dashboard live updates | DONE | `apps/command-ui/public/main.js` uses `EventSource` for live incident refresh with polling fallback. |
| Security headers | DONE | `withSecurityHeaders()` applies `nosniff`, frame denial, no-referrer and resource policy to JSON/static/SSE responses. |
| Request body size limits | DONE | `readJsonBody()` enforces configurable `MAX_JSON_BODY_BYTES` and returns 413 on oversized payloads. |
| Invalid JSON handling | DONE | Invalid request JSON returns 400; covered by `tests/integration/control-api-hardening.mjs`. |
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
| Human-in-the-loop critical alert handling | PARTIAL | Critical incidents can be acknowledged/escalated by operators; formal SLA/escalation policy pending. |

## Phase 6 - Evidence Lifecycle and Deployment Readiness

| Requirement | Status | Evidence |
|---|---|---|
| Evidence encryption at rest | PARTIAL | `EVIDENCE_ENCRYPTION_KEY` enables AES-256-GCM encrypted generated evidence artifacts in `edge/analytics/src/evidence.mjs`; object-store/KMS integration pending. |
| Encrypted evidence verification | DONE | Hash verification covers encrypted artifacts; `tests/integration/encrypted-evidence.mjs` decrypts and verifies generated evidence. |
| Evidence retention policy | DONE | `expireEvidenceManifests()` marks old manifests `EXPIRED` and can delete local assets. |
| Retention API | DONE | `POST /api/evidence/retention/run` requires COMMANDER permission and writes audit event. |
| Retention CLI | DONE | `npm run evidence:retention` runs cleanup for scheduled jobs. |
| Production env template | DONE | `.env.example` documents runtime, security, rate limit and evidence lifecycle settings without secrets. |
| Compose healthcheck | DONE | `deploy/compose/compose.yaml` waits for `control-api` health before starting `edge-bridge`. |
| Deployment runbook | DONE | `docs/runbooks/README.md` documents smoke tests, operator workflow and retention procedure. |
| Production TLS/mTLS | BLOCKED | Requires deployment gateway/certificates. |

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
| Metrics endpoint | DONE | `GET /api/metrics` |
| Audit log | DONE | append-only audit entries in `services/control-api/src/store.mjs` |
| Split vision-to-analytics bridge | DONE | `edge/vision-runtime/src/simulate-tracks.mjs`, `edge/analytics/src/track-bridge.mjs` |
| ANPR rule foundation | PARTIAL | `edge/analytics/src/anpr.mjs`; OCR source pending. |
| Suspicious-activity rule foundation | PARTIAL | `edge/analytics/src/suspicious-activity.mjs`; real-world tuning pending. |
| Virtual-fence policy hardening | DONE | `FenceIncidentPolicy`, class filters, active schedule and cooldown in `edge/analytics/src/virtual-fence.mjs`. |
| Privacy redaction foundation | PARTIAL | `edge/vision-runtime/src/privacy-redaction.mjs`; no identity recognition or embeddings. |
| Night/tamper analytics foundation | PARTIAL | `edge/analytics/src/night-watch.mjs`; deterministic rules, not field-calibrated claims. |
| Analytics incident builder | DONE | `edge/analytics/src/incident-builder.mjs` validates generated night/suspicious incidents against contract. |
| Realtime incident stream | DONE | SSE stream in `services/control-api/src/server.mjs`; dashboard subscribes through `EventSource`. |
| API security helpers | PARTIAL | `services/control-api/src/security.mjs` covers hashed device keys, in-memory rate limits and operator RBAC foundation. |
| Incident acknowledgement workflow | DONE | API/UI support acknowledge and escalate actions with audit trail and SSE refresh. |
| Evidence lifecycle controls | DONE | Optional encryption plus API/CLI retention cleanup with audit trail. |
| Docker Compose development path | PARTIAL | `deploy/compose/compose.yaml` includes env-file and healthcheck; production gateway/TLS still pending. |

## Current Verification Commands

```bash
npm test
npm run verify:stable
```

## Known Security and Privacy Limitations

- New and rotated device keys are hashed in local JSON; existing legacy plaintext keys are accepted only for backward compatibility until rotation.
- Operator RBAC foundation exists, but there is no persistent login/session UI, MFA, or TLS/mTLS enforcement yet.
- Rate limiting is in-memory and single-process only; production should use a shared limiter behind the deployment gateway.
- Face detection has a privacy-only candidate/redaction foundation; no identity recognition, matching or biometric embeddings are implemented.
- ANPR has only rule/voting foundations and no OCR model integration yet.
- Privacy redaction currently emits blur instructions; production video/image blur rendering still needs frame pipeline integration.
- Evidence encryption and retention exist for local filesystem artifacts; production object storage/KMS integration is still pending.
- No measured accuracy, false-alert rate, or camera capacity should be claimed.

## Next Highest-Priority Phase

Next priority should validate with real RTSP/USB camera footage and model assets: ANPR OCR integration, face detector integration, pixel blur rendering, performance baselines and measured accuracy/false-alert reporting.
