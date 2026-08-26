# edge-agent

ONVIF/RTSP ingest, camera discovery, health checks, reconnect, 24-72h encrypted ring buffer, store-and-forward sync.
Stack: GStreamer, Python/C++, Redis/NATS, Docker.

Current foundation:

- local evidence data directory
- durable JSON outbox for incidents when command connectivity is down
- replay helper that resubmits queued incidents with idempotency keys
- camera source normalization for USB, local video, RTSP and ONVIF placeholder URIs
- stream-health tracker with credential redaction, dropped-frame counts and reconnect backoff

Camera source config example:

```json
{
  "cameraId": "cam-bop-01-east",
  "sourceType": "RTSP",
  "streamUri": "rtsp://operator:secret@camera.local/stream1",
  "frameSampling": { "targetFps": 8, "maxDecodeFps": 25 },
  "runtime": { "mode": "CPU", "tracker": "bytetrack" }
}
```

Do not log raw RTSP URLs; use `redactUri()` before printing or sending stream metadata.
