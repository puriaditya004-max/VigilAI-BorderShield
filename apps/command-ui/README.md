# command-ui

React + TypeScript operator HMI (Human-Machine Interface).
Live geospatial map, incident triage, replay, audit views.
Stack: React, TypeScript, MapLibre, WebSocket, Playwright tests.

Current executable UI is a dependency-free static command console served by `control-api`.

Run:

```bash
npm run command-ui:start
```

Open:

```text
http://localhost:7080/
```

The UI shows camera health, incident feed, severity counts and audit events from the local control API.
