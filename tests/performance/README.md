# performance tests

FPS, latency, capacity and soak tests.

Next measurable gates:

- `vision_fps`: frames processed per second per camera source
- `incident_latency_ms`: capture time to control API acceptance
- `outbox_replay_ms`: queued incident replay duration after command link recovery
- `api_p95_ms`: control API P95 response time under expected camera count

The current suite proves correctness first; performance benchmarks should be added once real video/RTSP sources are connected.
