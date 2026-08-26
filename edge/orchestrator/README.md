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
npm run edge:orchestrate -- --mode=python-yolo --source=0 --model=yolov8n.pt
```

The real producer still requires external Python dependencies and model files. Do not treat fixture or simulator success as measured AI accuracy.
