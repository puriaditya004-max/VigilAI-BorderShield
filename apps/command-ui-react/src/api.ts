import type { AuditEvent, Camera, DashboardData, EvidenceManifest, Incident, Metrics, OperatorRole, Zone } from "./types";

export interface OperatorContext {
  operatorId: string;
  role: OperatorRole;
  token?: string;
}

const API_BASE = "";

export async function fetchDashboardData(operator: OperatorContext): Promise<DashboardData> {
  const [health, cameras, zones, incidents, evidence, audit, metrics] = await Promise.all([
    getJson<DashboardData["health"]>("/health", operator),
    getJson<Camera[]>("/api/cameras", operator),
    getJson<Zone[]>("/api/zones", operator),
    getJson<Incident[]>("/api/incidents", operator),
    getJson<EvidenceManifest[]>("/api/evidence/manifests", operator),
    getJson<AuditEvent[]>("/api/audit", operator),
    getJson<Metrics>("/api/metrics", operator)
  ]);

  return { health, cameras, zones, incidents, evidence, audit, metrics };
}

export async function updateIncidentStatus(
  incidentId: string,
  action: "acknowledge" | "escalate",
  body: { note: string; target?: string },
  operator: OperatorContext
): Promise<Incident> {
  return postJson<Incident>(`/api/incidents/${encodeURIComponent(incidentId)}/${action}`, body, operator);
}

export function evidenceAssetUrl(assetUrl: string): string {
  return `${API_BASE}${assetUrl}`;
}

export function operatorHeaders(operator: OperatorContext, extra: HeadersInit = {}): HeadersInit {
  const headers: Record<string, string> = {
    "x-operator-id": operator.operatorId,
    "x-operator-role": operator.role,
    ...(extra as Record<string, string>)
  };
  if (operator.token) headers.authorization = `Bearer ${operator.token}`;
  return headers;
}

async function getJson<T>(path: string, operator: OperatorContext): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: operatorHeaders(operator)
  });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown, operator: OperatorContext): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: operatorHeaders(operator, {
      "content-type": "application/json",
      "idempotency-key": `react-ui-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json() as Promise<T>;
}
