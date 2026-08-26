import { pointInPolygon } from "./suspicious-activity.mjs";

export function assessLowLightQuality(frameStats, config = {}) {
  const minBrightness = Number(config.minBrightness ?? 0.22);
  const minContrast = Number(config.minContrast ?? 0.12);
  const brightness = normalizeMetric(frameStats.brightness);
  const contrast = normalizeMetric(frameStats.contrast);
  const reasonCodes = [];

  if (brightness < minBrightness) reasonCodes.push("BRIGHTNESS_BELOW_THRESHOLD");
  if (contrast < minContrast) reasonCodes.push("CONTRAST_BELOW_THRESHOLD");

  return {
    lowLight: reasonCodes.length > 0,
    confidence: reasonCodes.length === 0 ? 0 : confidenceFromDeficit([
      deficitRatio(brightness, minBrightness),
      deficitRatio(contrast, minContrast)
    ]),
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["LIGHT_LEVEL_ACCEPTABLE"],
    metrics: { brightness, contrast, minBrightness, minContrast }
  };
}

export function detectNightMovement(trackEvent, zone, frameStats, config = {}) {
  const quality = assessLowLightQuality(frameStats, config);
  if (!quality.lowLight) return noDetection("NIGHT_MOVEMENT", "LIGHT_LEVEL_ACCEPTABLE", quality.metrics);

  const last = trackEvent.trajectory?.at(-1);
  if (zone?.polygon && (!last || !pointInPolygon(last, zone.polygon))) {
    return noDetection("NIGHT_MOVEMENT", "TRACK_OUTSIDE_NIGHT_ZONE", quality.metrics);
  }

  return {
    detected: true,
    type: "NIGHT_MOVEMENT",
    cameraId: trackEvent.cameraId,
    trackId: trackEvent.trackId,
    zoneId: zone?.zoneId,
    severity: config.severity || zone?.nightSeverity || "HIGH",
    confidence: quality.confidence,
    reasonCodes: ["LOW_LIGHT_CONFIRMED", "TRACK_PRESENT_IN_MONITORED_ZONE"],
    metrics: quality.metrics
  };
}

export function detectFrameTamper(frameStats, config = {}) {
  const brightness = normalizeMetric(frameStats.brightness);
  const contrast = normalizeMetric(frameStats.contrast);
  const sharpness = normalizeMetric(frameStats.sharpness);
  const blockedRatio = normalizeMetric(frameStats.blockedRatio);
  const minContrast = Number(config.minContrast ?? 0.04);
  const minSharpness = Number(config.minSharpness ?? 0.05);
  const maxBlockedRatio = Number(config.maxBlockedRatio ?? 0.7);
  const signalLost = frameStats.signalLost === true;
  const reasonCodes = [];

  if (signalLost) reasonCodes.push("VIDEO_SIGNAL_LOST");
  if (blockedRatio >= maxBlockedRatio) reasonCodes.push("FRAME_OCCLUSION_THRESHOLD_EXCEEDED");
  if (contrast <= minContrast && brightness < 0.08) reasonCodes.push("FRAME_BLACKOUT_SUSPECTED");
  if (sharpness <= minSharpness && contrast <= minContrast) reasonCodes.push("LENS_BLUR_OR_DEFOCUS_SUSPECTED");

  if (reasonCodes.length === 0) {
    return noDetection("CAMERA_TAMPER", "FRAME_QUALITY_ACCEPTABLE", {
      brightness,
      contrast,
      sharpness,
      blockedRatio
    });
  }

  return {
    detected: true,
    type: "CAMERA_TAMPER",
    cameraId: frameStats.cameraId,
    severity: config.severity || "HIGH",
    confidence: Math.max(
      signalLost ? 0.95 : 0,
      blockedRatio,
      confidenceFromDeficit([deficitRatio(contrast, minContrast), deficitRatio(sharpness, minSharpness)])
    ),
    reasonCodes,
    metrics: { brightness, contrast, sharpness, blockedRatio, minContrast, minSharpness, maxBlockedRatio }
  };
}

function noDetection(type, reasonCode, metrics = {}) {
  return { detected: false, type, reasonCodes: [reasonCode], metrics };
}

function normalizeMetric(value) {
  return Math.max(0, Math.min(1, Math.round(Number(value ?? 0) * 1000) / 1000));
}

function deficitRatio(value, minimum) {
  if (minimum <= 0) return 0;
  return Math.max(0, (minimum - value) / minimum);
}

function confidenceFromDeficit(deficits) {
  const maxDeficit = Math.max(...deficits, 0);
  return Math.max(0.5, Math.min(0.99, Math.round((0.5 + maxDeficit * 0.49) * 1000) / 1000));
}
