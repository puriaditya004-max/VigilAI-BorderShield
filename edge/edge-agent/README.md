# edge-agent

ONVIF/RTSP ingest, camera discovery, health checks, reconnect, 24-72h encrypted ring buffer, store-and-forward sync.
Stack: GStreamer, Python/C++, Redis/NATS, Docker.

Current foundation:

- local evidence data directory
- durable JSON outbox for incidents when command connectivity is down
- replay helper that resubmits queued incidents with idempotency keys
