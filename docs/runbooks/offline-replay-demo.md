# Offline Replay Field Demo

Use this drill to verify that the edge path queues incidents when the command API is unavailable and replays them after the link returns.

## 1. Start the Command API

```powershell
cd C:\Users\puria\Downloads\VigilAI-BorderShield\VigilAI-BorderShield
$env:PORT="7080"
npm run control-api:start
```

Keep this terminal open.

## 2. Start the Real Camera Edge Pipeline

In a second terminal:

```powershell
cd C:\Users\puria\Downloads\VigilAI-BorderShield\VigilAI-BorderShield
$env:CONTROL_API_URL="http://localhost:7080"
$env:FACE_DETECT_COMMAND="python"
$env:FACE_DETECT_ARGS="edge/vision-runtime/python/opencv_face_runtime.py --image {imagePath}"
$env:ANPR_PLATE_DETECT_COMMAND="python"
$env:ANPR_PLATE_DETECT_ARGS="edge/analytics/python/opencv_plate_detector.py --image {imagePath}"
npm run edge:orchestrate -- --mode python-yolo --source 0 --model yolov8n.pt --keyframe-dir reports/keyframes
```

Walk across the configured virtual fence so at least one incident is created.

## 3. Simulate Link Loss

Stop the Command API terminal with `Ctrl+C` while the edge pipeline is still running. Trigger another incident from the camera. The edge bridge should keep running and queue unsent incident JSON files under:

```text
edge/edge-agent/data/outbox
```

Confirm queued files:

```powershell
Get-ChildItem edge\edge-agent\data\outbox
```

## 4. Restore the Link

Restart the Command API:

```powershell
npm run control-api:start
```

Then let the edge pipeline send another incident or rerun the edge pipeline. `replayOutbox()` runs after a successful incident submission and sends queued events.

## 5. Confirm Replay

```powershell
Invoke-RestMethod http://localhost:7080/api/incidents -Headers @{"x-operator-id"="commander-1";"x-operator-role"="COMMANDER"}
Invoke-RestMethod http://localhost:7080/api/evidence/manifests -Headers @{"x-operator-id"="commander-1";"x-operator-role"="COMMANDER"}
```

Expected result: queued incidents appear in the API, verified evidence manifests are present for accepted submissions, and the outbox directory drains after replay. Do not claim link-loss timing or delivery-rate metrics from this drill; measure those separately with timestamps and labelled runs.
