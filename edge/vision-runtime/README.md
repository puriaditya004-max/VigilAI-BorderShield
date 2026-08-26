# vision-runtime

Decode + GPU inference + tracking (ByteTrack).
TensorRT/Triton serving, ONNX Runtime CPU fallback.
Stack: PyTorch, ONNX, TensorRT, DeepStream.

Current executable slice:

- converts YOLO/ByteTrack-style detections into strict `TrackEvent` payloads
- supports person and vehicle classes used by the existing VigilAI reference code
- preserves model lineage on every emitted event
- provides privacy-only face detection adapter support for redaction candidates, with no identity recognition or embeddings

Run:

```bash
node edge/vision-runtime/src/simulate-tracks.mjs
```

Next production step is replacing the simulator input with real OpenCV + Ultralytics/ONNX inference while keeping the same `TrackEvent` adapter boundary.

Python runtime scaffold:

```bash
python edge/vision-runtime/python/yolo_track_runtime.py --source 0
python edge/vision-runtime/python/yolo_track_runtime.py --source rtsp://camera/stream1
```

It follows the VigilAI reference pattern: OpenCV source -> YOLO `model.track()` -> person/vehicle `TrackEvent` JSON lines. Install `ultralytics` and `opencv-python` before running it against a real camera/video.

Face detection runtime for redaction candidates:

```bash
python edge/vision-runtime/python/opencv_face_runtime.py --image frame.jpg
```

This emits face bounding boxes for privacy blur planning only. It does not perform face recognition, identity matching, or embedding generation.
