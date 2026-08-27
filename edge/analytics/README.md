# analytics

ANPR, face-detection redaction support, night/low-light analytics, behavior + virtual fence.
Stack: OpenCV, OCR, model serving, calibration.

Current executable slice:

- virtual fence crossing logic
- ANPR plate-detector adapter, crop-quality validation, normalization, masking, temporal voting and optional OCR runtime adapter
- suspicious activity and night/tamper rule foundations
- evidence hash placeholder generation
- `IncidentEvent` creation
- online submit or offline outbox queue

Run with the control API running:

```bash
npm run edge:simulate
```

This simulator proves the production event path. Real YOLO/ByteTrack from the existing VigilAI reference project should plug into `edge/vision-runtime/` and emit `TrackEvent` payloads.

Optional ANPR OCR runtime:

```bash
python edge/analytics/python/paddleocr_plate_runtime.py --image plate-crop.jpg
```

The Node adapter `ocrPlateImage()` consumes runtime JSON and then applies the existing format validation and temporal voting. It does not hardcode or fabricate plate text.

Optional ANPR plate detector runtime:

```bash
python edge/analytics/python/opencv_plate_detector.py --image frame.jpg
```

Set `ANPR_PLATE_DETECT_COMMAND=python` and `ANPR_PLATE_DETECT_ARGS="edge/analytics/python/opencv_plate_detector.py --image {imagePath}"` to enable the built-in OpenCV candidate localizer. It returns candidate bounding boxes only; it never fabricates plate text. Production use can point the same variables at an approved detector that returns plate bounding boxes. The pipeline rejects missing, tiny or blurry crops before OCR and keeps complete accuracy metrics as not measured until labelled footage is supplied.
