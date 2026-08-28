export type OperatorRole = "VIEWER" | "OPERATOR" | "COMMANDER";

export interface Camera {
  cameraId: string;
  name: string;
  edgeNodeId?: string;
  location: string;
  streamUri?: string | null;
  status: "ONLINE" | "OFFLINE" | string;
  registeredAt?: string;
  lastHeartbeat?: string;
  lastQuality?: unknown;
  lastStream?: unknown;
}

export interface Zone {
  zoneId: string;
  cameraId: string;
  name: string;
  severity?: Severity;
}

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
export type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "ESCALATED" | string;

export interface Incident {
  schemaVersion?: string;
  incidentId: string;
  eventId?: string;
  cameraId: string;
  zoneId: string;
  type: string;
  severity: Severity;
  confidence?: number;
  status: IncidentStatus;
  captureTime: string;
  receivedAt?: string;
  evidence?: {
    manifestId?: string;
    sha256?: string;
  };
  model?: {
    name?: string;
    version?: string;
    checksum?: string;
  };
  rule?: {
    id?: string;
    version?: string;
    reasonCodes?: string[];
  };
  metrics?: Record<string, unknown>;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  acknowledgementNote?: string | null;
  escalatedBy?: string;
  escalatedAt?: string;
  escalationTarget?: string;
  escalationNote?: string | null;
}

export interface EvidenceAsset {
  kind: string;
  sha256: string;
  contentType: string | null;
  assetUrl: string;
}

export interface EvidenceManifest {
  manifestId: string;
  incidentId: string;
  cameraId?: string;
  status: string;
  sha256: string;
  receivedAt?: string;
  assetCount: number;
  assets: EvidenceAsset[];
  clipUri?: string;
  metadata?: {
    evidenceMode?: string;
    clipReasonCodes?: string[];
    redactions?: Array<Record<string, unknown>>;
    privacy?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface AuditEvent {
  schemaVersion: string;
  auditId: string;
  actor: string;
  action: string;
  resource: string;
  requestId?: string;
  createdAt: string;
}

export interface Metrics {
  schemaVersion?: string;
  cameras?: {
    total: number;
    online: number;
  };
  incidents?: {
    total: number;
    open: number;
    bySeverity: Record<string, number>;
    sla?: {
      overdue?: number;
    };
  };
  evidence?: {
    verified: number;
    expired?: number;
  };
  audit?: {
    total: number;
  };
}

export interface DashboardData {
  health: { status: string; service: string; time: string };
  cameras: Camera[];
  zones: Zone[];
  incidents: Incident[];
  evidence: EvidenceManifest[];
  audit: AuditEvent[];
  metrics: Metrics;
}

export interface OperatorSession {
  operatorId: string;
  username?: string;
  role: OperatorRole;
  token?: string;
  permissions?: string[];
}
