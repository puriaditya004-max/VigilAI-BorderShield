import { useState } from "react";
import { evidenceAssetUrl, updateIncidentStatus } from "./api";
import { useDashboardData } from "./hooks/useDashboardData";
import type { EvidenceManifest, Incident, OperatorRole } from "./types";

export function App() {
  const [role, setRole] = useState<OperatorRole>("COMMANDER");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"acknowledge" | "escalate" | null>(null);
  const { data, operator, connectionState, error, refresh, setData } = useDashboardData(role);
  const loading = connectionState === "loading";
  const selectedIncident = data.incidents.find((incident) => incident.incidentId === selectedIncidentId) || data.incidents[0] || null;
  const selectedEvidence = selectedIncident ? data.evidence.find((manifest) => manifest.incidentId === selectedIncident.incidentId || manifest.manifestId === selectedIncident.evidence?.manifestId) : null;

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
              <IncidentCard
                incident={incident}
                key={incident.incidentId}
                selected={selectedIncident?.incidentId === incident.incidentId}
                onSelect={() => setSelectedIncidentId(incident.incidentId)}
              />
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

          <Panel title="Incident Detail">
            {selectedIncident ? (
              <IncidentDetail
                incident={selectedIncident}
                evidence={selectedEvidence}
                note={actionNote}
                actionError={actionError}
                pendingAction={pendingAction}
                onNoteChange={setActionNote}
                onAction={async (action) => {
                  setPendingAction(action);
                  setActionError(null);
                  const previousData = data;
                  const optimisticStatus = action === "acknowledge" ? "ACKNOWLEDGED" : "ESCALATED";
                  setData({
                    ...data,
                    incidents: data.incidents.map((incident) => incident.incidentId === selectedIncident.incidentId ? { ...incident, status: optimisticStatus } : incident)
                  });
                  try {
                    await updateIncidentStatus(selectedIncident.incidentId, action, {
                      note: actionNote || `${action === "acknowledge" ? "Acknowledged" : "Escalated"} from React command UI`,
                      target: "sector-command"
                    }, operator);
                    setActionNote("");
                    await refresh();
                  } catch (err) {
                    setData(previousData);
                    setActionError(err instanceof Error ? err.message : "Incident action failed");
                  } finally {
                    setPendingAction(null);
                  }
                }}
              />
            ) : (
              <EmptyState message="Select an incident to inspect evidence and workflow actions." />
            )}
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

function IncidentCard({ incident, selected, onSelect }: { incident: Incident; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={selected ? "incident-card selected" : "incident-card"} onClick={onSelect}>
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
    </button>
  );
}

function IncidentDetail({
  incident,
  evidence,
  note,
  actionError,
  pendingAction,
  onNoteChange,
  onAction
}: {
  incident: Incident;
  evidence: EvidenceManifest | null;
  note: string;
  actionError: string | null;
  pendingAction: "acknowledge" | "escalate" | null;
  onNoteChange: (value: string) => void;
  onAction: (action: "acknowledge" | "escalate") => void;
}) {
  const imageAsset = evidence?.assets.find((asset) => asset.contentType?.startsWith("image/"));
  const videoAsset = evidence?.assets.find((asset) => asset.contentType === "video/mp4");
  const unavailableReasons = evidence?.metadata?.clipReasonCodes || [];
  const canAcknowledge = incident.status === "OPEN";

  return (
    <div className="detail">
      <div className="detail-heading">
        <div>
          <h3>{incident.type.replaceAll("_", " ")}</h3>
          <p>{incident.incidentId}</p>
        </div>
        <span className={`severity ${String(incident.severity).toLowerCase()}`}>{incident.severity}</span>
      </div>

      <div className="detail-grid">
        <StatusLine label="Status" value={incident.status} />
        <StatusLine label="Confidence" value={incident.confidence === undefined ? "Not provided" : String(incident.confidence)} />
        <StatusLine label="Model" value={incident.model?.version || incident.model?.name || "Not provided"} />
        <StatusLine label="Rule" value={incident.rule?.version || incident.rule?.id || "Not provided"} />
      </div>

      <section className="reason-box">
        <h4>Reason Codes</h4>
        {incident.rule?.reasonCodes?.length ? (
          <ul>
            {incident.rule.reasonCodes.map((code) => <li key={code}>{code}</li>)}
          </ul>
        ) : (
          <p>No reason codes supplied by the backend.</p>
        )}
      </section>

      <section className="evidence-box">
        <h4>Evidence</h4>
        {imageAsset ? (
          <img src={evidenceAssetUrl(imageAsset.assetUrl)} alt={`Evidence keyframe for ${incident.incidentId}`} />
        ) : (
          <div className="empty">Evidence unavailable: keyframe asset not present</div>
        )}
        {videoAsset ? (
          <video src={evidenceAssetUrl(videoAsset.assetUrl)} controls />
        ) : (
          <div className="empty">Evidence unavailable: {unavailableReasons.length ? unavailableReasons.join(", ") : "MP4 clip asset not present"}</div>
        )}
      </section>

      <section className="workflow-box">
        <h4>Operator Workflow</h4>
        <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Optional note" rows={3} />
        <div className="actions">
          <button type="button" disabled={!canAcknowledge || pendingAction !== null} onClick={() => onAction("acknowledge")}>
            {pendingAction === "acknowledge" ? "Acknowledging..." : "Acknowledge"}
          </button>
          <button type="button" disabled={pendingAction !== null} onClick={() => onAction("escalate")}>
            {pendingAction === "escalate" ? "Escalating..." : "Escalate"}
          </button>
        </div>
        {actionError ? <p className="error-text">{actionError}</p> : null}
      </section>
    </div>
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
