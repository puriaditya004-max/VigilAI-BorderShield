const API_BASE = "";

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  apiStatus: document.querySelector("#apiStatus"),
  cameraCount: document.querySelector("#cameraCount"),
  incidentCount: document.querySelector("#incidentCount"),
  highCount: document.querySelector("#highCount"),
  auditCount: document.querySelector("#auditCount"),
  incidentList: document.querySelector("#incidentList"),
  cameraList: document.querySelector("#cameraList"),
  auditList: document.querySelector("#auditList")
};

els.refreshButton.addEventListener("click", refresh);
refresh();
setInterval(refresh, 5000);

async function refresh() {
  try {
    const [health, cameras, incidents, audit] = await Promise.all([
      getJson("/health"),
      getJson("/api/cameras"),
      getJson("/api/incidents"),
      getJson("/api/audit")
    ]);

    els.apiStatus.textContent = health.status === "ok" ? "Online" : "Degraded";
    els.apiStatus.dataset.state = health.status === "ok" ? "online" : "degraded";
    renderMetrics(cameras, incidents, audit);
    renderIncidents(incidents);
    renderCameras(cameras);
    renderAudit(audit);
  } catch (error) {
    els.apiStatus.textContent = "Offline";
    els.apiStatus.dataset.state = "offline";
    els.incidentList.innerHTML = `<div class="empty">Control API unavailable: ${escapeHtml(error.message)}</div>`;
  }
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

function renderMetrics(cameras, incidents, audit) {
  els.cameraCount.textContent = cameras.length;
  els.incidentCount.textContent = incidents.filter((item) => item.status === "OPEN").length;
  els.highCount.textContent = incidents.filter((item) => ["HIGH", "CRITICAL"].includes(item.severity)).length;
  els.auditCount.textContent = audit.length;
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
    </article>
  `).join("");
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
