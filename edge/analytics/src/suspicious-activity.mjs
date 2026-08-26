export function detectLoitering(trackEvent, zone, config = {}) {
  const minDwellMs = Number(config.minDwellMs ?? 30000);
  const points = pointsInsideZone(trackEvent.trajectory, zone);
  if (points.length < 2) return noActivity("LOITERING", "INSUFFICIENT_ZONE_POINTS");

  const dwellMs = Date.parse(points.at(-1).t) - Date.parse(points[0].t);
  if (dwellMs < minDwellMs) return noActivity("LOITERING", "DWELL_TIME_BELOW_THRESHOLD", { dwellMs });

  return activity("LOITERING", trackEvent, zone, {
    confidence: confidenceFromRatio(dwellMs / minDwellMs),
    reasonCodes: ["TRACK_INSIDE_ZONE", "DWELL_TIME_EXCEEDED"],
    metrics: { dwellMs, minDwellMs }
  });
}

export function detectRepeatedBoundaryApproach(trackEvent, zone, config = {}) {
  const thresholdPx = Number(config.thresholdPx ?? 40);
  const minApproaches = Number(config.minApproaches ?? 3);
  const approaches = trackEvent.trajectory.filter((point) => distanceToLine(point, zone.line) <= thresholdPx).length;

  if (approaches < minApproaches) {
    return noActivity("REPEATED_BOUNDARY_APPROACH", "APPROACH_COUNT_BELOW_THRESHOLD", { approaches });
  }

  return activity("REPEATED_BOUNDARY_APPROACH", trackEvent, zone, {
    confidence: confidenceFromRatio(approaches / minApproaches),
    reasonCodes: ["BOUNDARY_PROXIMITY_REPEATED", "TRACK_PERSISTENCE_CONFIRMED"],
    metrics: { approaches, minApproaches, thresholdPx }
  });
}

export function detectCrowdFormation(trackEvents, zone, config = {}) {
  const minObjects = Number(config.minObjects ?? 4);
  const inside = trackEvents.filter((track) => {
    const last = track.trajectory.at(-1);
    return last && pointInPolygon(last, zone.polygon);
  });

  if (inside.length < minObjects) {
    return noActivity("CROWD_FORMATION", "OBJECT_COUNT_BELOW_THRESHOLD", { objectCount: inside.length });
  }

  return {
    detected: true,
    type: "CROWD_FORMATION",
    zoneId: zone.zoneId,
    severity: config.severity || "MEDIUM",
    confidence: confidenceFromRatio(inside.length / minObjects),
    reasonCodes: ["MULTIPLE_TRACKS_INSIDE_ZONE", "DENSITY_THRESHOLD_EXCEEDED"],
    metrics: { objectCount: inside.length, minObjects },
    trackIds: inside.map((track) => track.trackId)
  };
}

export function detectSuddenSpeedChange(trackEvent, config = {}) {
  const minRatio = Number(config.minRatio ?? 2.5);
  const speeds = segmentSpeeds(trackEvent.trajectory);
  if (speeds.length < 2) return noActivity("SUDDEN_SPEED_CHANGE", "INSUFFICIENT_TRAJECTORY");

  const previous = speeds.at(-2);
  const latest = speeds.at(-1);
  const ratio = previous === 0 ? latest : latest / previous;
  if (ratio < minRatio) return noActivity("SUDDEN_SPEED_CHANGE", "SPEED_RATIO_BELOW_THRESHOLD", { ratio });

  return {
    detected: true,
    type: "SUDDEN_SPEED_CHANGE",
    cameraId: trackEvent.cameraId,
    trackId: trackEvent.trackId,
    severity: config.severity || "MEDIUM",
    confidence: confidenceFromRatio(ratio / minRatio),
    reasonCodes: ["TRACK_SPEED_CHANGED", "CALIBRATION_REQUIRED_FOR_WORLD_SPEED"],
    metrics: { ratio, minRatio, latestPixelsPerSecond: latest }
  };
}

function activity(type, trackEvent, zone, details) {
  return {
    detected: true,
    type,
    cameraId: trackEvent.cameraId,
    trackId: trackEvent.trackId,
    zoneId: zone.zoneId,
    severity: details.severity || "MEDIUM",
    confidence: details.confidence,
    reasonCodes: details.reasonCodes,
    metrics: details.metrics
  };
}

function noActivity(type, reasonCode, metrics = {}) {
  return { detected: false, type, reasonCodes: [reasonCode], metrics };
}

function pointsInsideZone(trajectory, zone) {
  if (!zone.polygon) return [];
  return trajectory.filter((point) => pointInPolygon(point, zone.polygon));
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentSpeeds(trajectory) {
  const speeds = [];
  for (let index = 1; index < trajectory.length; index += 1) {
    const prev = trajectory[index - 1];
    const next = trajectory[index];
    const seconds = Math.max(0.001, (Date.parse(next.t) - Date.parse(prev.t)) / 1000);
    speeds.push(distance(prev, next) / seconds);
  }
  return speeds;
}

function distanceToLine(point, line) {
  const numerator = Math.abs((line.b.x - line.a.x) * (line.a.y - point.y) - (line.a.x - point.x) * (line.b.y - line.a.y));
  const denominator = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
  return denominator === 0 ? Infinity : numerator / denominator;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function confidenceFromRatio(ratio) {
  return Math.max(0.1, Math.min(0.99, Math.round(ratio * 500) / 1000));
}
