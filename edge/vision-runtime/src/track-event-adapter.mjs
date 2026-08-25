const VEHICLE_CLASS_IDS = new Set([2, 3, 5, 7]);
const VEHICLE_CLASS_NAMES = new Set(["car", "motorcycle", "bus", "truck", "vehicle"]);

export function detectionToObjectClass(detection) {
  const className = String(detection.className || "").toLowerCase();
  if (detection.classId === 0 || className === "person") return "PERSON";
  if (VEHICLE_CLASS_IDS.has(detection.classId) || VEHICLE_CLASS_NAMES.has(className)) return "VEHICLE";
  return null;
}

export function toTrackEvent({ detection, cameraId, frameTime, model, previousTrajectory = [] }) {
  const objectClass = detectionToObjectClass(detection);
  if (!objectClass) return null;

  const bbox = normalizeBbox(detection.bbox);
  const center = {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height,
    t: frameTime
  };

  const trajectory = [...previousTrajectory, center].slice(-12);
  const trackId = String(detection.trackId ?? `${objectClass.toLowerCase()}-${stableBoxId(bbox)}`);

  return {
    schemaVersion: "track-event.v1",
    eventId: `evt-track-${cameraId}-${trackId}-${Date.parse(frameTime)}`,
    cameraId,
    trackId,
    objectClass,
    confidence: roundConfidence(detection.confidence ?? 0),
    bbox,
    trajectory,
    captureTime: frameTime,
    model
  };
}

export function adaptFrameDetections({ cameraId, frameTime, detections, model, state = new Map() }) {
  const events = [];

  for (const detection of detections) {
    const trackKey = String(detection.trackId ?? stableBoxId(normalizeBbox(detection.bbox)));
    const previousTrajectory = state.get(trackKey) || [];
    const event = toTrackEvent({ detection, cameraId, frameTime, model, previousTrajectory });
    if (!event) continue;

    state.set(trackKey, event.trajectory);
    events.push(event);
  }

  return { events, state };
}

function normalizeBbox(bbox) {
  if (Array.isArray(bbox)) {
    const [x1, y1, x2, y2] = bbox.map(Number);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  return {
    x: Number(bbox.x),
    y: Number(bbox.y),
    width: Number(bbox.width),
    height: Number(bbox.height)
  };
}

function stableBoxId(bbox) {
  return `${Math.round(bbox.x / 10)}-${Math.round(bbox.y / 10)}-${Math.round(bbox.width / 10)}-${Math.round(bbox.height / 10)}`;
}

function roundConfidence(value) {
  return Math.max(0, Math.min(1, Math.round(Number(value) * 1000) / 1000));
}
