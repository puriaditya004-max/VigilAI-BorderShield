import http from "node:http";
import {
  cleanupRuntime,
  createRuntimeContext,
  getFreePort,
  startControlApi,
  stopProcess
} from "../helpers/runtime.mjs";

const root = process.cwd();
const ctx = createRuntimeContext("notification-webhook");
const apiPort = await getFreePort();
const webhookPort = await getFreePort();
const endpoint = `http://localhost:${apiPort}`;
const webhookEndpoint = `http://localhost:${webhookPort}/alerts`;
const camera = {
  cameraId: "cam-bop-01-east",
  name: "BOP 01 East Gate Camera",
  edgeNodeId: "edge-bop-01",
  location: "East perimeter",
  streamUri: "rtsp://camera.local/stream1"
};

const received = [];
let webhook;
let server;

try {
  webhook = await startWebhook();
  server = await startControlApi({
    cwd: root,
    port: apiPort,
    env: {
      ...ctx.env,
      ALERT_WEBHOOK_URL: webhookEndpoint,
      ALERT_WEBHOOK_TOKEN: "test-alert-token",
      ALERT_MIN_SEVERITY: "HIGH"
    }
  });

  const registered = await postJson("/api/cameras/register", camera, {});
  await postJson("/api/incidents", incidentPayload("inc-webhook-high", "HIGH"), {
    "x-device-key": registered.deviceKey,
    "idempotency-key": "idem-webhook-high"
  });
  await postJson("/api/incidents/inc-webhook-high/escalate", { target: "sector-command", note: "dispatch" }, {
    "x-operator-id": "commander-1",
    "x-operator-role": "COMMANDER",
    "idempotency-key": "idem-webhook-escalate"
  });
  await postJson("/api/incidents", incidentPayload("inc-webhook-low", "LOW"), {
    "x-device-key": registered.deviceKey,
    "idempotency-key": "idem-webhook-low"
  });

  assert(received.length === 2, "high incident create and escalation should notify, low should be skipped");
  assert(received.every((item) => item.authorization === "Bearer test-alert-token"), "webhook token should be sent");
  assert(received.some((item) => item.body.eventName === "incident.created" && item.body.incidentId === "inc-webhook-high"), "create notification missing");
  assert(received.some((item) => item.body.eventName === "incident.escalated" && item.body.status === "ESCALATED"), "escalation notification missing");

  const audit = await fetchJson("/api/audit");
  assert(audit.filter((event) => event.action === "notification.delivered").length === 2, "delivered notifications should be audited");

  console.log("PASS notification-webhook integration");
} finally {
  await stopProcess(server);
  await closeWebhook(webhook);
  cleanupRuntime(ctx);
}

function incidentPayload(incidentId, severity) {
  return {
    schemaVersion: "incident-event.v1",
    eventId: `evt-${incidentId}`,
    incidentId,
    cameraId: camera.cameraId,
    zoneId: "zone-east-fence",
    type: "VIRTUAL_FENCE_INTRUSION",
    severity,
    reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED"],
    captureTime: "2026-08-27T00:00:00.000Z",
    evidence: { manifestId: `manifest-${incidentId}`, sha256: "c".repeat(64) }
  };
}

function startWebhook() {
  return new Promise((resolve) => {
    const app = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk.toString();
      received.push({
        authorization: req.headers.authorization,
        body: JSON.parse(raw)
      });
      res.writeHead(204);
      res.end();
    });
    app.listen(webhookPort, () => resolve(app));
  });
}

function closeWebhook(app) {
  if (!app) return Promise.resolve();
  return new Promise((resolve) => app.close(resolve));
}

async function postJson(route, body, headers) {
  const response = await fetch(`${endpoint}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

async function fetchJson(route) {
  const response = await fetch(`${endpoint}${route}`, {
    headers: { "x-operator-id": "viewer-1", "x-operator-role": "VIEWER" }
  });
  if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
