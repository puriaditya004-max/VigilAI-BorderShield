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
