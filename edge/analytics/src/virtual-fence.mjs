export function sideOfLine(point, line) {
  const { a, b } = line;
  return Math.sign((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));
}

export function crossedFence(trajectory, zone) {
  if (!trajectory || trajectory.length < 2) return false;

  const first = trajectory[0];
  const last = trajectory[trajectory.length - 1];
  const startSide = sideOfLine(first, zone.line);
  const endSide = sideOfLine(last, zone.line);

  if (startSide === 0 || endSide === 0 || startSide === endSide) return false;

  if (zone.direction === "ANY") return true;
  if (zone.direction === "LEFT_TO_RIGHT") return first.x < zone.line.a.x && last.x > zone.line.a.x;
  if (zone.direction === "RIGHT_TO_LEFT") return first.x > zone.line.a.x && last.x < zone.line.a.x;

  return true;
}

export class FenceIncidentPolicy {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.lastIncidentAt = new Map();
  }

  evaluate({ trackEvent, zone }) {
    const evaluatedAt = this.now();
    const staticDecision = evaluateFenceIntrusion({ trackEvent, zone, evaluatedAt });
    if (!staticDecision.allowed) return staticDecision;

    const cooldownMs = Number(zone.cooldownMs ?? 0);
    const key = `${trackEvent.cameraId}:${trackEvent.trackId}:${zone.zoneId}`;
    const previousAt = this.lastIncidentAt.get(key);
    const currentMs = Date.parse(evaluatedAt.toISOString());

    if (cooldownMs > 0 && previousAt && currentMs - previousAt < cooldownMs) {
      return blocked("DUPLICATE_COOLDOWN_ACTIVE", {
        cooldownMs,
        remainingMs: cooldownMs - (currentMs - previousAt)
      });
    }

    this.lastIncidentAt.set(key, currentMs);
    return staticDecision;
  }
}

export function evaluateFenceIntrusion({ trackEvent, zone, evaluatedAt = new Date() }) {
  if (!zone.enabled && zone.enabled !== undefined) return blocked("ZONE_DISABLED");
  if (!isZoneActive(zone, evaluatedAt)) return blocked("ZONE_OUTSIDE_ACTIVE_SCHEDULE");
  if (!objectClassAllowed(trackEvent, zone)) return blocked("OBJECT_CLASS_NOT_MONITORED");

  const minTrajectoryPoints = Number(zone.minTrajectoryPoints ?? 2);
  if (!trackEvent.trajectory || trackEvent.trajectory.length < minTrajectoryPoints) {
    return blocked("INSUFFICIENT_TRAJECTORY_POINTS", { minTrajectoryPoints });
  }

  if (!crossedFence(trackEvent.trajectory, zone)) return blocked("FENCE_NOT_CROSSED");

  return {
    allowed: true,
    reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED", "ZONE_POLICY_MATCHED"]
  };
}

export function isZoneActive(zone, evaluatedAt = new Date()) {
  const schedule = zone.schedule;
  if (!schedule) return true;

  if (Array.isArray(schedule.utcDays) && schedule.utcDays.length > 0) {
    const day = evaluatedAt.getUTCDay();
    if (!schedule.utcDays.includes(day)) return false;
  }

  if (schedule.utcStartHour === undefined || schedule.utcEndHour === undefined) return true;

  const hour = evaluatedAt.getUTCHours() + evaluatedAt.getUTCMinutes() / 60;
  const start = Number(schedule.utcStartHour);
  const end = Number(schedule.utcEndHour);
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function objectClassAllowed(trackEvent, zone) {
  if (!Array.isArray(zone.objectClasses) || zone.objectClasses.length === 0) return true;
  return zone.objectClasses.includes(trackEvent.objectClass);
}

export function buildIntrusionIncident({ trackEvent, zone, evidence, decision }) {
  const incidentId = `inc-${trackEvent.cameraId}-${Date.now()}`;

  return {
    schemaVersion: "incident-event.v1",
    eventId: `evt-${incidentId}`,
    incidentId,
    cameraId: trackEvent.cameraId,
    zoneId: zone.zoneId,
    type: "VIRTUAL_FENCE_INTRUSION",
    severity: zone.severity || "HIGH",
    reasonCodes: decision?.reasonCodes || ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED"],
    captureTime: trackEvent.captureTime,
    evidence: {
      manifestId: evidence.manifestId,
      sha256: evidence.sha256,
      keyframeUri: evidence.keyframeUri,
      clipUri: evidence.clipUri
    }
  };
}

function blocked(reasonCode, metrics = {}) {
  return { allowed: false, reasonCodes: [reasonCode], metrics };
}
