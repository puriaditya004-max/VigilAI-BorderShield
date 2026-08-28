let incidentSequence = 0;

export function createIncidentId({
  cameraId,
  type = "incident",
  trackId = "frame",
  captureTime = new Date().toISOString()
}) {
  incidentSequence = (incidentSequence + 1) % Number.MAX_SAFE_INTEGER;
  const timestamp = safeTimestamp(captureTime);
  const sequence = incidentSequence.toString(36).padStart(4, "0");
  return `inc-${slug(cameraId)}-${slug(type)}-${slug(trackId || "frame")}-${timestamp}-${sequence}`;
}

function safeTimestamp(captureTime) {
  const parsed = Date.parse(captureTime);
  return Number.isFinite(parsed) ? String(parsed) : String(Date.now());
}

function slug(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "unknown";
}
