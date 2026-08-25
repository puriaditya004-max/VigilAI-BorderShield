# analytics

ANPR, face detection/authorized matching, night/low-light analytics, behavior + virtual fence.
Stack: OpenCV, OCR, model serving, calibration.

Current executable slice:

- virtual fence crossing logic
- evidence hash placeholder generation
- `IncidentEvent` creation
- online submit or offline outbox queue

Run with the control API running:

```bash
npm run edge:simulate
```

This simulator proves the production event path. Real YOLO/ByteTrack from the existing VigilAI reference project should plug into `edge/vision-runtime/` and emit `TrackEvent` payloads.
