# runbooks

Operations, recovery and security runbooks.

## Local End-to-End Smoke Test

1. Start the control API and command UI:

```bash
npm run control-api:start
```

2. In another terminal, generate simulated `TrackEvent` payloads and pipe them into analytics:

```bash
npm run --silent vision:simulate | npm run --silent edge:bridge
```

3. Open:

```text
http://localhost:7080/
```

Expected result:

- one camera is online
- one virtual-fence incident is open
- one evidence manifest is verified
- audit contains camera, incident and evidence actions

## Real Camera Smoke Test

After installing `ultralytics` and `opencv-python`, replace the simulator:

```bash
python edge/vision-runtime/python/yolo_track_runtime.py --source 0 --max-frames 200 | npm run edge:bridge
```

Use an RTSP URL in place of `0` for an IP camera. The Python process emits `TrackEvent` JSON lines; the Node bridge owns policy decisions, evidence, sync and replay.

## Evidence Retention Run

1. Configure retention:

```bash
copy .env.example .env
```

Set:

- `EVIDENCE_RETENTION_DAYS`
- `EVIDENCE_RETENTION_DELETE_FILES`
- `EVIDENCE_ENCRYPTION_KEY` when encrypted evidence is required

2. Run retention from the command line:

```bash
npm run evidence:retention
```

Expected result:

- manifests older than the retention window are marked `EXPIRED`
- local `file://` assets for expired manifests are deleted when `EVIDENCE_RETENTION_DELETE_FILES=true`
- audit contains `evidence.retention_run`

## Operator Workflow Smoke Test

The local dashboard uses default development operator headers. For API calls, send:

```text
x-operator-id: operator-1
x-operator-role: COMMANDER
authorization: Bearer <OPERATOR_TOKEN>   # only when OPERATOR_TOKEN is set
```

Use `OPERATOR` for acknowledgement and `COMMANDER` for escalation or retention cleanup.
