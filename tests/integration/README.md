# integration tests

Camera-to-incident, link-loss, replay, recovery integration tests.

Run:

```bash
npm run integration:test
```

Current test starts the control API, runs the edge virtual-fence simulator, and verifies camera registration, incident persistence, evidence output, and audit logging.
