# edge-orchestrator

Production-oriented edge pipeline supervisor.

Current executable slice:

- loads one camera configuration for USB, local video or RTSP sources
- starts either the deterministic simulator or the real Python OpenCV/YOLO producer
- streams producer `TrackEvent` JSON into the analytics bridge
- keeps producer stderr as structured operator logs so stdout remains JSON summaries
- records runtime duration, source type, edge runtime mode and incident count
- handles termination signals by stopping the producer process

Run simulator mode:

```bash
npm run edge:orchestrate
```

Run real OpenCV/YOLO mode:

```bash
npm run edge:orchestrate -- --mode=python-yolo --source=0 --model=yolov8n.pt --keyframe-dir=reports/keyframes
```

The orchestrator passes `--keyframe_dir` into the Python runtime so real producer `TrackEvent.frame.uri` values are populated and the analytics bridge can generate non-SVG evidence from captured keyframes. The real producer still requires external Python dependencies and model files. Do not treat fixture or simulator success as measured AI accuracy.

## Live preview for manual field testing and demos

For an operator standing near the camera, enable the local OpenCV preview window:

```bash
npm run edge:orchestrate -- --mode=python-yolo --source=0 --model=yolov8n.pt --keyframe-dir=reports/keyframes --preview
```

The preview draws the real YOLO track boxes and person/vehicle labels from the same inference pass that emits `TrackEvent` JSON. Yellow fence lines come from the configured zone file for the active camera and are mapped back to the camera's actual frame resolution. A red border flash means the local preview observed the same kind of trajectory crossing that the analytics bridge uses for incident generation. The status strip shows capture resolution, current FPS and object count.

This is only for interactive field testing and SIH-style demos. Leave it off in CI, services and unattended deployments; the networked command dashboard remains `apps/command-ui`.
