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

export function buildIntrusionIncident({ trackEvent, zone, evidence }) {
  const incidentId = `inc-${trackEvent.cameraId}-${Date.now()}`;

  return {
    schemaVersion: "incident-event.v1",
    eventId: `evt-${incidentId}`,
    incidentId,
    cameraId: trackEvent.cameraId,
    zoneId: zone.zoneId,
    type: "VIRTUAL_FENCE_INTRUSION",
    severity: zone.severity || "HIGH",
    reasonCodes: ["TRACK_CROSSED_RESTRICTED_LINE", "PERSISTENCE_CONFIRMED"],
    captureTime: trackEvent.captureTime,
    evidence: {
      manifestId: evidence.manifestId,
      sha256: evidence.sha256,
      keyframeUri: evidence.keyframeUri,
      clipUri: evidence.clipUri
    }
  };
}
