import { useState } from "react";
import { useDashboardData } from "./hooks/useDashboardData";
import type { Incident, OperatorRole } from "./types";

export function App() {
  const [role, setRole] = useState<OperatorRole>("COMMANDER");
  const { data, connectionState, error, refresh } = useDashboardData(role);
  const loading = connectionState === "loading";

  const highCritical = (data.metrics.incidents?.bySeverity?.HIGH || 0) + (data.metrics.incidents?.bySeverity?.CRITICAL || 0);
  const openIncidents = data.metrics.incidents?.open ?? data.incidents.filter((incident) => incident.status === "OPEN").length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">VigilAI BorderShield</p>
          <h1>Command Center</h1>
        </div>
        <div className="toolbar">
          <label>
            <span>Role</span>
            {/* Dev convenience only. Real authentication belongs to a later backend auth milestone. */}
            <select value={role} onChange={(event) => setRole(event.target.value as OperatorRole)}>
              <option value="VIEWER">Viewer</option>
              <option value="OPERATOR">Operator</option>
              <option value="COMMANDER">Commander</option>
            </select>
          </label>
          <button type="button" onClick={refresh}>Refresh</button>
          <span className="status" data-state={error ? "offline" : "online"}>
            {error ? "Offline" : connectionState === "live" ? "Live" : connectionState === "polling" ? "Polling" : "Checking"}
          </span>
        </div>
      </header>

      {error ? <div className="banner">Control API unavailable: {error}</div> : null}

      <section className="metrics" aria-label="System overview">
        <Metric label="Cameras" value={data.metrics.cameras?.total ?? data.cameras.length} />
        <Metric label="Online" value={data.metrics.cameras?.online ?? data.cameras.filter((camera) => camera.status === "ONLINE").length} />
        <Metric label="Open Incidents" value={openIncidents} />
        <Metric label="High/Critical" value={highCritical} />
        <Metric label="Audit Events" value={data.metrics.audit?.total ?? data.audit.length} />
        <Metric label="Evidence" value={data.metrics.evidence?.verified ?? data.evidence.length} />
      </section>

      <section className="command-grid">
        <Panel title="Incident Feed" wide>
          {loading ? <EmptyState message="Loading incidents..." /> : null}
          {!loading && data.incidents.length === 0 ? <EmptyState message="No incidents yet. Run the edge pipeline to populate the feed." /> : null}
          <div className="incident-list">
            {data.incidents.map((incident) => (
              <IncidentCard incident={incident} key={incident.incidentId} />
            ))}
          </div>
        </Panel>

        <div className="side-stack">
          <Panel title="System Overview">
          {loading ? (
            <EmptyState message="Loading command telemetry..." />
          ) : (
            <div className="overview-grid">
              <StatusLine label="API" value={data.health.status} />
              <StatusLine label="Zones" value={String(data.zones.length)} />
              <StatusLine label="SLA Overdue" value={String(data.metrics.incidents?.sla?.overdue ?? 0)} />
              <StatusLine label="Last Refresh" value={data.health.time ? formatTime(data.health.time) : "Waiting"} />
            </div>
          )}
          </Panel>

          <Panel title="Cameras">
          {loading ? <EmptyState message="Loading cameras..." /> : null}
          {!loading && data.cameras.length === 0 ? <EmptyState message="No cameras registered." /> : null}
          <div className="list">
            {data.cameras.map((camera) => (
              <article className="camera-row" key={camera.cameraId}>
                <div>
                  <strong>{camera.name}</strong>
                  <span>{camera.location}</span>
                </div>
                <span className="pill" data-state={camera.status === "ONLINE" ? "online" : "offline"}>{camera.status}</span>
              </article>
            ))}
          </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? "panel panel-wide" : "panel"}>
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <article className="incident-card">
      <div className="incident-title">
        <span className={`severity ${String(incident.severity).toLowerCase()}`}>{incident.severity}</span>
        <div>
          <h3>{incident.type.replaceAll("_", " ")}</h3>
          <p>{incident.cameraId} / {incident.zoneId}</p>
        </div>
        <span className="incident-status">{incident.status}</span>
      </div>
      <dl className="incident-meta">
        <div>
          <dt>Incident</dt>
          <dd>{incident.incidentId}</dd>
        </div>
        <div>
          <dt>Evidence SHA</dt>
          <dd>{incident.evidence?.sha256 ? `${incident.evidence.sha256.slice(0, 18)}...` : "Unavailable"}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{formatTime(incident.captureTime)}</dd>
        </div>
      </dl>
    </article>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}
