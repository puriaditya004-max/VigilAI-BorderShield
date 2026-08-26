const API_BASE = "";
const OPERATOR = {
  id: localStorage.getItem("vigilai.operatorId") || "local-operator",
  role: localStorage.getItem("vigilai.operatorRole") || "COMMANDER",
  token: localStorage.getItem("vigilai.operatorToken") || ""
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  apiStatus: document.querySelector("#apiStatus"),
  cameraCount: document.querySelector("#cameraCount"),
  incidentCount: document.querySelector("#incidentCount"),
  highCount: document.querySelector("#highCount"),
  auditCount: document.querySelector("#auditCount"),
  evidenceCount: document.querySelector("#evidenceCount"),
  incidentList: document.querySelector("#incidentList"),
  cameraList: document.querySelector("#cameraList"),
  auditList: document.querySelector("#auditList"),
  evidenceList: document.querySelector("#evidenceList")
};

els.refreshButton.addEventListener("click", refresh);
els.incidentList.addEventListener("click", handleIncidentAction);
refresh();
connectEventStream();
setInterval(refresh, 30000);

async function refresh() {
  try {
    const [health, cameras, incidents, audit, evidence, metrics] = await Promise.all([
      getJson("/health"),
      getJson("/api/cameras"),
      getJson("/api/incidents"),
      getJson("/api/audit"),
      getJson("/api/evidence/manifests"),
      getJson("/api/metrics")
    ]);

    els.apiStatus.textContent = health.status === "ok" ? "Online" : "Degraded";
    els.apiStatus.dataset.state = health.status === "ok" ? "online" : "degraded";
    renderMetrics(cameras, incidents, audit, evidence, metrics);
    renderIncidents(incidents);
    renderCameras(cameras);
    renderAudit(audit);
    renderEvidence(evidence);
  } catch (error) {
    els.apiStatus.textContent = "Offline";
    els.apiStatus.dataset.state = "offline";
    els.incidentList.innerHTML = `<div class="empty">Control API unavailable: ${escapeHtml(error.message)}</div>`;
  }
}

function connectEventStream() {
  if (!("EventSource" in window)) return;

  const stream = new EventSource(`${API_BASE}/api/events`);
  stream.addEventListener("ready", () => {
    els.apiStatus.textContent = "Live";
    els.apiStatus.dataset.state = "online";
  });
  stream.addEventListener("incident.created", () => {
    refresh();
  });
  stream.addEventListener("incident.acknowledged", () => {
    refresh();
  });
  stream.addEventListener("incident.escalated", () => {
    refresh();
  });
  stream.onerror = () => {
    els.apiStatus.textContent = "Reconnecting";
    els.apiStatus.dataset.state = "degraded";
  };
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

async function postJson(path, body) {
  const headers = {
    "content-type": "application/json",
    "x-operator-id": OPERATOR.id,
    "x-operator-role": OPERATOR.role,
    "idempotency-key": `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`
  };
  if (OPERATOR.token) headers.authorization = `Bearer ${OPERATOR.token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

function renderMetrics(cameras, incidents, audit, evidence, metrics) {
  els.cameraCount.textContent = metrics?.cameras?.total ?? cameras.length;
  els.incidentCount.textContent = metrics?.incidents?.open ?? incidents.filter((item) => item.status === "OPEN").length;
  els.highCount.textContent = (metrics?.incidents?.bySeverity?.HIGH || 0) + (metrics?.incidents?.bySeverity?.CRITICAL || 0);
  els.auditCount.textContent = metrics?.audit?.total ?? audit.length;
  els.evidenceCount.textContent = metrics?.evidence?.verified ?? evidence.length;
}

function renderIncidents(incidents) {
  if (!incidents.length) {
    els.incidentList.innerHTML = `<div class="empty">No incidents yet. Run <code>npm run edge:simulate</code>.</div>`;
    return;
  }

  els.incidentList.innerHTML = incidents.map((incident) => `
    <article class="incident">
      <div class="incident-main">
        <span class="badge ${incident.severity.toLowerCase()}">${incident.severity}</span>
        <div>
          <h3>${escapeHtml(incident.type.replaceAll("_", " "))}</h3>
          <p>${escapeHtml(incident.cameraId)} / ${escapeHtml(incident.zoneId)}</p>
        </div>
      </div>
      <dl>
        <div><dt>Incident</dt><dd>${escapeHtml(incident.incidentId)}</dd></div>
        <div><dt>Evidence SHA</dt><dd>${escapeHtml(incident.evidence.sha256.slice(0, 18))}...</dd></div>
        <div><dt>Captured</dt><dd>${formatTime(incident.captureTime)}</dd></div>
      </dl>
      ${renderIncidentActions(incident)}
    </article>
  `).join("");
}

function renderIncidentActions(incident) {
  if (incident.status === "ACKNOWLEDGED") {
    return `<div class="incident-actions handled">Acknowledged by ${escapeHtml(incident.acknowledgedBy || "operator")}</div>`;
  }
  if (incident.status === "ESCALATED") {
    return `<div class="incident-actions handled">Escalated to ${escapeHtml(incident.escalationTarget || "command")}</div>`;
  }

  return `
    <div class="incident-actions">
      <button type="button" data-action="acknowledge" data-incident-id="${escapeHtml(incident.incidentId)}">Acknowledge</button>
      <button type="button" data-action="escalate" data-incident-id="${escapeHtml(incident.incidentId)}">Escalate</button>
    </div>
  `;
}

async function handleIncidentAction(event) {
  const button = event.target.closest("button[data-action][data-incident-id]");
  if (!button) return;

  button.disabled = true;
  const action = button.dataset.action;
  const incidentId = button.dataset.incidentId;
  try {
    await postJson(`/api/incidents/${encodeURIComponent(incidentId)}/${action}`, {
      note: action === "acknowledge" ? "Acknowledged from command UI" : "Escalated from command UI",
      target: "sector-command"
    });
    await refresh();
  } catch (error) {
    els.apiStatus.textContent = error.message;
    els.apiStatus.dataset.state = "degraded";
    button.disabled = false;
  }
}

function renderCameras(cameras) {
  els.cameraList.innerHTML = cameras.length ? cameras.map((camera) => `
    <article class="row">
      <strong>${escapeHtml(camera.name)}</strong>
      <span>${escapeHtml(camera.status)} / ${escapeHtml(camera.location)}</span>
    </article>
  `).join("") : `<div class="empty">No cameras registered.</div>`;
}

function renderAudit(audit) {
  els.auditList.innerHTML = audit.length ? audit.slice(0, 8).map((event) => `
    <article class="row">
      <strong>${escapeHtml(event.action)}</strong>
      <span>${escapeHtml(event.resource)} / ${formatTime(event.createdAt)}</span>
    </article>
  `).join("") : `<div class="empty">No audit events.</div>`;
}

function renderEvidence(evidence) {
  els.evidenceList.innerHTML = evidence.length ? evidence.slice(0, 8).map((manifest) => `
    <article class="row">
      <strong>${escapeHtml(manifest.status)} / ${escapeHtml(manifest.manifestId)}</strong>
      <span>${escapeHtml(manifest.incidentId)} / ${escapeHtml(manifest.sha256.slice(0, 18))}...</span>
    </article>
  `).join("") : `<div class="empty">No evidence manifests.</div>`;
}

function formatTime(value) {
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
