const DEFAULT_SLA_MINUTES = {
  CRITICAL: 5,
  HIGH: 15,
  MEDIUM: 60,
  LOW: 240
};

const HANDLED_STATUSES = new Set(["ACKNOWLEDGED", "ESCALATED", "CLOSED"]);

export function parseSlaPolicy(value = process.env.INCIDENT_SLA_MINUTES) {
  if (!value) return DEFAULT_SLA_MINUTES;
  const parsed = { ...DEFAULT_SLA_MINUTES };
  for (const part of String(value).split(",")) {
    const [severity, minutes] = part.split(":").map((item) => item.trim());
    if (!severity || !minutes) continue;
    const numericMinutes = Number(minutes);
    if (Number.isFinite(numericMinutes) && numericMinutes > 0) {
      parsed[severity.toUpperCase()] = numericMinutes;
    }
  }
  return parsed;
}

export function incidentSlaState(incident, {
  now = new Date(),
  policy = parseSlaPolicy()
} = {}) {
  const severity = String(incident.severity || "MEDIUM").toUpperCase();
  const minutes = Number(policy[severity] || policy.MEDIUM || DEFAULT_SLA_MINUTES.MEDIUM);
  const openedAtMs = Date.parse(incident.receivedAt || incident.captureTime || "");
  const openedAt = Number.isFinite(openedAtMs) ? new Date(openedAtMs) : new Date(now);
  const dueAt = new Date(openedAt.getTime() + minutes * 60 * 1000);
  const handled = HANDLED_STATUSES.has(String(incident.status || "OPEN").toUpperCase());
  const overdue = !handled && dueAt.getTime() < now.getTime();

  return {
    incidentId: incident.incidentId,
    severity,
    status: incident.status || "OPEN",
    openedAt: openedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    slaMinutes: minutes,
    handled,
    overdue,
    remainingMs: handled ? 0 : dueAt.getTime() - now.getTime()
  };
}

export function buildSlaSummary(incidents, options = {}) {
  const states = incidents.map((incident) => incidentSlaState(incident, options));
  return {
    schemaVersion: "incident-sla-summary.v1",
    generatedAt: (options.now || new Date()).toISOString(),
    total: states.length,
    open: states.filter((state) => !state.handled).length,
    overdue: states.filter((state) => state.overdue).length,
    dueSoon: states.filter((state) => !state.handled && !state.overdue && state.remainingMs <= 5 * 60 * 1000).length,
    incidents: states
  };
}
