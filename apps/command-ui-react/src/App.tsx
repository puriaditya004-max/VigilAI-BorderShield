import { useEffect, useMemo, useState } from "react";
import { fetchDashboardData } from "./api";
import type { DashboardData, OperatorRole } from "./types";

const emptyData: DashboardData = {
  health: { status: "unknown", service: "control-api", time: "" },
  cameras: [],
  zones: [],
  incidents: [],
  evidence: [],
  audit: [],
  metrics: {}
};

export function App() {
  const [role, setRole] = useState<OperatorRole>("COMMANDER");
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const operator = useMemo(() => ({
    operatorId: "sih-demo-operator",
    role
  }), [role]);

  async function refresh() {
    try {
      setError(null);
      const next = await fetchDashboardData(operator);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Control API unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer);
  }, [operator]);

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
            {error ? "Offline" : data.health.status === "ok" ? "Online" : "Checking"}
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

      <section className="layout">
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
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
