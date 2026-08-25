# integration tests

Camera-to-incident, link-loss, replay, recovery integration tests.

Run:

```bash
npm run integration:test
```

Current tests start the control API, run the edge virtual-fence simulator, verify camera registration, incident persistence, evidence output and audit logging, then verify offline outbox replay.
