const FACE_CLASS_NAMES = new Set(["face", "person-face", "human-face"]);
const PLATE_CLASS_NAMES = new Set(["license_plate", "licence_plate", "number_plate", "plate"]);

export function detectionToPrivacyTarget(detection) {
  const className = String(detection.className || "").toLowerCase();
  if (FACE_CLASS_NAMES.has(className)) return "FACE";
  if (PLATE_CLASS_NAMES.has(className)) return "PLATE";
  return null;
}

export function buildFaceCandidate({ detection, cameraId, frameTime, frameSize }) {
  if (detectionToPrivacyTarget(detection) !== "FACE") return null;

  return {
    schemaVersion: "face-candidate.v1",
    candidateId: `face-${cameraId}-${stableBoxId(normalizeBbox(detection.bbox))}-${Date.parse(frameTime)}`,
    cameraId,
    targetType: "FACE",
    bbox: clampBbox(expandBbox(normalizeBbox(detection.bbox), 0.18), frameSize),
    confidence: roundConfidence(detection.confidence ?? 0),
    captureTime: frameTime,
    identityRecognition: false,
    reasonCodes: ["FACE_DETECTED_FOR_PRIVACY_REDACTION", "IDENTITY_RECOGNITION_DISABLED"]
  };
}

export function buildPrivacyRedactionPlan({
  detections,
  frameSize,
  faceBlurEnabled = true,
  plateBlurEnabled = true,
  minConfidence = 0.45
}) {
  const targets = [];

  for (const detection of detections) {
    const targetType = detectionToPrivacyTarget(detection);
    if (!targetType || Number(detection.confidence ?? 0) < minConfidence) continue;

    const enabled = targetType === "FACE" ? faceBlurEnabled : plateBlurEnabled;
    targets.push({
      targetType,
      bbox: clampBbox(expandBbox(normalizeBbox(detection.bbox), targetType === "FACE" ? 0.18 : 0.08), frameSize),
      confidence: roundConfidence(detection.confidence ?? 0),
      action: enabled ? "BLUR" : "DETECT_ONLY",
      method: enabled ? "GAUSSIAN_BLUR" : "NONE",
      reasonCodes: enabled
        ? [`${targetType}_PRIVACY_REDACTION_ENABLED`]
        : [`${targetType}_DETECTED_REDACTION_DISABLED`]
    });
  }

  return {
    schemaVersion: "privacy-redaction-plan.v1",
    redactionRequired: targets.some((target) => target.action === "BLUR"),
    targets,
    reasonCodes: [
      "NO_IDENTITY_EMBEDDINGS_STORED",
      "NO_FACE_MATCHING_PERFORMED",
      targets.length > 0 ? "PRIVACY_TARGETS_DETECTED" : "NO_PRIVACY_TARGETS_DETECTED"
    ]
  };
}

export function assertNoBiometricIdentityFields(candidate) {
  const forbidden = ["personId", "identity", "name", "embedding", "faceEmbedding", "matchId"];
  const present = forbidden.filter((field) => Object.hasOwn(candidate, field));
  if (present.length > 0) {
    throw new Error(`Biometric identity fields are not allowed: ${present.join(", ")}`);
  }
  return true;
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

function expandBbox(bbox, ratio) {
  const padX = bbox.width * ratio;
  const padY = bbox.height * ratio;
  return {
    x: bbox.x - padX,
    y: bbox.y - padY,
    width: bbox.width + padX * 2,
    height: bbox.height + padY * 2
  };
}

function clampBbox(bbox, frameSize = {}) {
  const frameWidth = Number(frameSize.width ?? Infinity);
  const frameHeight = Number(frameSize.height ?? Infinity);
  const x = Math.max(0, Math.min(frameWidth, bbox.x));
  const y = Math.max(0, Math.min(frameHeight, bbox.y));
  const width = Math.max(0, Math.min(frameWidth - x, bbox.width));
  const height = Math.max(0, Math.min(frameHeight - y, bbox.height));

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function stableBoxId(bbox) {
  return `${Math.round(bbox.x / 10)}-${Math.round(bbox.y / 10)}-${Math.round(bbox.width / 10)}-${Math.round(bbox.height / 10)}`;
}

function roundConfidence(value) {
  return Math.max(0, Math.min(1, Math.round(Number(value) * 1000) / 1000));
}
