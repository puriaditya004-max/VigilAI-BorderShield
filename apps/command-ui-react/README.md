# VigilAI BorderShield React Command UI

Vite + React + TypeScript command dashboard for the Control API. The legacy static dashboard in `apps/command-ui/public` remains the fallback served at `/`.

Run the API and React dev server side by side:

```bash
npm run command-ui:start
npm run command-ui-react:dev
```

Build static assets:

```bash
npm run command-ui-react:build
```

Serve the built React UI from the Control API at `/app`:

```bash
COMMAND_UI_MODE=react npm run command-ui:start
```
