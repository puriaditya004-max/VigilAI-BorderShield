# vision-runtime

Decode + GPU inference + tracking (ByteTrack).
TensorRT/Triton serving, ONNX Runtime CPU fallback.
Stack: PyTorch, ONNX, TensorRT, DeepStream.

Current executable slice:

- converts YOLO/ByteTrack-style detections into strict `TrackEvent` payloads
- supports person and vehicle classes used by the existing VigilAI reference code
- preserves model lineage on every emitted event

Run:

```bash
node edge/vision-runtime/src/simulate-tracks.mjs
```

Next production step is replacing the simulator input with real OpenCV + Ultralytics/ONNX inference while keeping the same `TrackEvent` adapter boundary.
