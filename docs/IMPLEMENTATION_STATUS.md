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
| Face detection only by default | NOT STARTED | Planned privacy-preserving module; no biometric storage implemented. |
| Optional privacy blur | NOT STARTED | No blur pipeline yet. |
| ANPR / number-plate OCR | NOT STARTED | No detector/OCR/temporal voting module yet. |
| Virtual-fence intrusion | DONE | `edge/analytics/src/virtual-fence.mjs`, `edge/analytics/config/zones.json`, tested by unit/integration/e2e. |
| Suspicious-activity analytics | NOT STARTED | No loitering, boundary approach, running, density or tamper modules yet. |
| Night-movement analytics | NOT STARTED | No low-light quality rule or preprocessing pipeline yet. |
| Real-time alerting and event logging | PARTIAL | Control API incident/audit flow exists; no WebSocket/SSE yet. |
| Command-and-control dashboard | PARTIAL | Static dashboard in `apps/command-ui/public/`; React/TypeScript HMI not implemented. |
| Existing CCTV/RTSP compatibility | PARTIAL | Python runtime accepts OpenCV sources including RTSP; ONVIF discovery not implemented. |
| Offline edge operation and synchronization | PARTIAL | Durable JSON outbox and replay in `edge/edge-agent/src/outbox.mjs`; no encrypted rolling buffer. |
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
| Docker Compose development path | PARTIAL | `deploy/compose/compose.yaml`; production hardening pending. |

## Current Verification Commands

```bash
npm test
npm run verify:stable
```

## Known Security and Privacy Limitations

- Device keys are stored in local JSON for development; production must store hashed keys.
- No operator login, RBAC, MFA, rate limiting, or TLS/mTLS enforcement yet.
- Face detection and ANPR are not implemented; no biometric embeddings are stored.
- Evidence is local filesystem based; production needs encrypted storage and retention enforcement.
- No measured accuracy, false-alert rate, or camera capacity should be claimed.

## Next Highest-Priority Phase

Phase 1 should connect a real local video/RTSP source through `edge/vision-runtime/python/yolo_track_runtime.py`, produce `TrackEvent` JSON lines, and pipe them into `npm run edge:bridge`. If real footage is unavailable, add a small synthetic/generated fixture video that is legally safe to commit.
