import http from "node:http";
import https from "node:https";

const SEVERITY_RANK = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
};

export function shouldNotifyIncident(incident, {
  webhookUrl = process.env.ALERT_WEBHOOK_URL,
  minSeverity = process.env.ALERT_MIN_SEVERITY || "HIGH"
} = {}) {
  if (!webhookUrl) return false;
  const incidentSeverity = SEVERITY_RANK[String(incident?.severity || "").toUpperCase()] || 0;
  const threshold = SEVERITY_RANK[String(minSeverity || "HIGH").toUpperCase()] || SEVERITY_RANK.HIGH;
  return incidentSeverity >= threshold;
}

export async function notifyIncidentEvent({
  eventName,
  incident,
  webhookUrl = process.env.ALERT_WEBHOOK_URL,
  token = process.env.ALERT_WEBHOOK_TOKEN,
  minSeverity = process.env.ALERT_MIN_SEVERITY || "HIGH",
  timeoutMs = Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || 5000)
} = {}) {
  if (!shouldNotifyIncident(incident, { webhookUrl, minSeverity })) {
    return { configured: Boolean(webhookUrl), delivered: false, skipped: true, reason: "severity_below_threshold_or_unconfigured" };
  }

  const payload = {
    schemaVersion: "alert-notification.v1",
    eventName,
    incidentId: incident.incidentId,
    eventId: incident.eventId,
    cameraId: incident.cameraId,
    zoneId: incident.zoneId,
    type: incident.type,
    severity: incident.severity,
    status: incident.status,
    captureTime: incident.captureTime,
    evidence: incident.evidence,
    reasonCodes: incident.reasonCodes || []
  };

  return postJsonWebhook({ webhookUrl, token, payload, timeoutMs });
}

async function postJsonWebhook({ webhookUrl, token, payload, timeoutMs }) {
  let url;
  try {
    url = new URL(webhookUrl);
  } catch (error) {
    return { configured: true, delivered: false, error: `invalid webhook url: ${error.message}` };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { configured: true, delivered: false, error: "webhook url must use http or https" };
  }

  const body = Buffer.from(JSON.stringify(payload));
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = transport.request(url, {
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "content-type": "application/json",
        "content-length": String(body.length),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      res.resume();
      res.on("end", () => {
        resolve({
          configured: true,
          delivered: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("notification webhook timed out"));
    });
    req.on("error", (error) => {
      resolve({ configured: true, delivered: false, error: error.message });
    });
    req.end(body);
  });
}
