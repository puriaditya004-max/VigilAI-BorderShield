export function buildAnalyticsIncident({ cameraId, zoneId, trackId, decision, evidence, captureTime = new Date().toISOString() }) {
  const type = incidentType(decision.type);
  const incidentId = `inc-${cameraId}-${String(decision.type || "analytics").toLowerCase()}-${Date.parse(captureTime)}`;

  return {
    schemaVersion: "incident-event.v1",
    eventId: `evt-${incidentId}`,
    incidentId,
    cameraId,
    zoneId: zoneId || decision.zoneId || "zone-unassigned",
    type,
    severity: decision.severity || "MEDIUM",
    reasonCodes: decision.reasonCodes,
    captureTime,
    evidence: {
      manifestId: evidence.manifestId,
      sha256: evidence.sha256,
      keyframeUri: evidence.keyframeUri,
      clipUri: evidence.clipUri
    }
  };
}

function incidentType(ruleType) {
  if (ruleType === "NIGHT_MOVEMENT") return "NIGHT_MOVEMENT";
  if (ruleType === "FACE_CANDIDATE") return "FACE_CANDIDATE";
  if (ruleType === "ANPR_CANDIDATE") return "ANPR_CANDIDATE";
  return "SUSPICIOUS_ACTIVITY";
}
