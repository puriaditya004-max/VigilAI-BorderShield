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

## Field Validation Report

Run a fixture-backed validation report:

```bash
npm run validation:field
```

Run a real-source validation report:

```bash
npm run validation:field -- --source 0 --model yolov8n.pt --max-frames 200 --report reports/field-validation.json
```

Expected result:

- JSON report includes camera, incident, evidence and audit counts
- pipeline exit codes are recorded
- accuracy fields remain `not_measured_without_labelled_dataset` until labelled footage is supplied

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

## Alert Webhook

Set these environment variables to forward HIGH/CRITICAL incident and commander-escalation alerts:

```bash
ALERT_WEBHOOK_URL=https://alerts.example.local/vigilai
ALERT_WEBHOOK_TOKEN=change-me
ALERT_MIN_SEVERITY=HIGH
ALERT_WEBHOOK_TIMEOUT_MS=5000
```

Webhook failures do not block incident ingestion; the control API records `notification.delivered` or `notification.failed` audit events.
