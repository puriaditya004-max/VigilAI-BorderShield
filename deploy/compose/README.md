# compose

Docker Compose manifests for SIH demo / single-post pilot deployment (2-3 containers, not twelve).

Current Compose file runs the dependency-free control API:

```bash
docker compose -f deploy/compose/compose.yaml up
```

The service stores local development state under `services/control-api/data/`, which is ignored by git.
