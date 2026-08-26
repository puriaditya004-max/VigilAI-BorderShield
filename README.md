# VigilAI BorderShield — SIH26-26187

Offline-first, software-defined border video intelligence platform that upgrades existing CCTV
(RTSP/ONVIF Profile T) into a measurable, auditable surveillance network — without requiring
dedicated FRS/ANPR/smart-camera hardware.

> Ministry of Home Affairs | Theme: Smart Automation
> This repo scaffolds the **target production architecture**. Not a claim of completed field
> deployment, certification, or measured 100% AI accuracy.

## Repository structure

```
VigilAI-BorderShield/
├── apps/command-ui/         React + TS operator HMI (map, triage, replay, audit)
├── services/
│   ├── control-api/         Cameras, zones, incidents, users, audit (NestJS)
│   └── evidence-service/    Clips, keyframes, hashes, retention (MinIO)
├── edge/
│   ├── edge-agent/          ONVIF/RTSP ingest, health, ring buffer, sync
│   ├── vision-runtime/      Decode + GPU inference + tracking
│   ├── orchestrator/        Real/simulated edge pipeline supervisor
│   └── analytics/           ANPR, face, night, behavior, fence
├── packages/
│   ├── contracts/           Protobuf / JSON Schema / OpenAPI shared contracts
│   └── security/            Device identity, mTLS, policy helpers
├── ml/
│   ├── datasets/            Manifests + DVC pointers (no secrets)
│   ├── training/            Reproducible train/eval/export jobs
│   └── model-registry/      Model cards, promotion metadata
├── deploy/
│   ├── compose/             SIH demo / single-post pilot
│   ├── k3s/                 Remote edge deployment
│   └── kubernetes/          Sector command deployment
├── tests/
│   ├── contract/            Schema + compatibility tests
│   ├── integration/         Camera-to-incident, link-loss, replay
│   └── performance/         FPS, latency, capacity, soak tests
└── docs/
    ├── adr/                 Architecture decision records
    └── runbooks/            Ops, recovery, security runbooks
```

Each folder has its own `README.md` explaining its scope and stack.

## Immediate build order

1. Freeze event schemas and golden sample payloads → `packages/contracts/`
2. Create RTSP replay source and edge-agent health path → `edge/edge-agent/`
3. Containerize current detector/tracker and publish `TrackEvent` → `edge/vision-runtime/`
4. Implement virtual-fence persistence and `IncidentEvent` → `edge/analytics/`
5. Store evidence manifest and display incident in command UI → `services/evidence-service/`, `apps/command-ui/`
6. Add link-loss queue, replay, metrics and acceptance report → `edge/edge-agent/`, `tests/integration/`

## Current executable foundation

Run contract and integration checks:

```bash
npm test
```

Run the stabilized suite three times:

```bash
npm run verify:stable
```

Run the control API:

```bash
npm run control-api:start
```

Run the virtual-fence edge simulator in another terminal:

```bash
npm run edge:simulate
```

This foundation does not claim field readiness. It proves the production event path: registered camera -> health event -> virtual-fence incident -> evidence hash -> command API persistence -> audit log.

Run the split vision-to-analytics pipeline:

```bash
npm run control-api:start
npm run --silent vision:simulate | npm run --silent edge:bridge
```

Then open `http://localhost:7080/` to view cameras, incidents, evidence and audit events.

Run the real OpenCV/YOLO producer through the same bridge:

```bash
python edge/vision-runtime/python/yolo_track_runtime.py --source 0 --model yolov8n.pt | npm run --silent edge:bridge
```

The Python runtime requests 1280x720 capture, logs the camera-reported resolution to stderr, and emits detections in the canonical 1280x720 zone coordinate space used by `edge/analytics/config/zones.json`. When a camera falls back to another resolution, coordinates are mapped with aspect-ratio-preserving letterbox scaling and the original source bbox is preserved in `sourceBbox`.

Run the orchestrated edge pipeline:

```bash
npm run edge:orchestrate
npm run edge:orchestrate -- --mode=python-yolo --source=0 --model=yolov8n.pt
```

The orchestrator starts the selected producer, streams producer JSON into the analytics bridge, keeps operational logs on stderr, and returns a JSON summary on stdout.

## Reuse from current VigilAI-Platform repo (commit 0690c45)

Reuse with refactoring:
- YOLO detection + ByteTrack tracking patterns (Vigil Exam / Vigil Traffic)
- Camera registration, per-camera API key, heartbeat concept
- Rule/decision engine patterns (persistence, cooldown)
- Evidence capture, alert APIs, PostgreSQL models, React dashboards

Must be replaced/hardened:
- Single-file camera loops, hardcoded localhost config → `edge/edge-agent/`
- Local webcam/video input → managed RTSP/ONVIF → `edge/edge-agent/`
- Simple pixel-to-speed conversion → camera calibration → `edge/vision-runtime/`
- No containers/CI/observability/SBOM → `deploy/`, `.github/workflows/`

## Six-member ownership map

| Member | Module | Folders |
|---|---|---|
| M1 | Edge & Camera Platform | `edge/edge-agent/` |
| M2 | Detection & Tracking | `edge/vision-runtime/` |
| M3 | ANPR, Face, Night | `edge/analytics/` |
| M4 | Intrusion & Behavior | `edge/analytics/` (fence/behavior modules) |
| M5 | Control, Data, Security | `services/control-api/`, `services/evidence-service/`, `packages/security/` |
| M6 | HMI, Integration, SRE | `apps/command-ui/`, `deploy/`, `tests/` |

## Reference

Full architecture blueprint: `SIH26_26187_VigilAI_BorderShield_Production_Architecture.pdf`
GitHub baseline: `puriaditya004-max/VigilAI-Platform`
