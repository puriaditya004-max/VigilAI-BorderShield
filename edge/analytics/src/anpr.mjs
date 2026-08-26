import { applyArgTemplate, runJsonCommand } from "../../vision-runtime/src/runtime-command.mjs";

const INDIA_PLATE_PATTERN = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/;

export function normalizePlateText(rawText) {
  return String(rawText || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isValidIndianPlate(normalizedText) {
  return INDIA_PLATE_PATTERN.test(normalizedText);
}

export function buildPlateCandidate({ cameraId, trackId, rawText, confidence, captureTime = new Date().toISOString() }) {
  const normalizedText = normalizePlateText(rawText);

  return {
    schemaVersion: "plate-candidate.v1",
    candidateId: `plate-${cameraId}-${trackId}-${Date.parse(captureTime)}`,
    cameraId,
    trackId,
    rawText: String(rawText || ""),
    normalizedText,
    validFormat: isValidIndianPlate(normalizedText),
    confidence: clampConfidence(confidence),
    captureTime
  };
}

export function buildPlateDetection({ cameraId, trackId, detection, frameSize, captureTime = new Date().toISOString() }) {
  const bbox = clampBbox(normalizeBbox(detection.bbox || detection.box || detection.xyxy), frameSize);
  const quality = assessPlateCropQuality({
    bbox,
    frameSize,
    quality: detection.quality
  });

  return {
    schemaVersion: "plate-detection.v1",
    detectionId: `plate-det-${cameraId}-${trackId}-${stableBoxId(bbox)}-${Date.parse(captureTime)}`,
    cameraId,
    trackId,
    bbox,
    confidence: clampConfidence(detection.confidence ?? detection.score ?? detection.probability),
    captureTime,
    quality,
    reasonCodes: quality.accepted ? ["PLATE_DETECTED", "CROP_QUALITY_ACCEPTABLE"] : quality.reasonCodes
  };
}

export function assessPlateCropQuality({ bbox, frameSize = {}, quality = {}, minWidth = 40, minHeight = 12, minSharpness = 0.08 } = {}) {
  const frameWidth = Number(frameSize.width ?? Infinity);
  const frameHeight = Number(frameSize.height ?? Infinity);
  const width = Number(bbox?.width ?? 0);
  const height = Number(bbox?.height ?? 0);
  const sharpness = Number(quality.sharpness ?? 1);
  const reasonCodes = [];

  if (width < minWidth || height < minHeight) reasonCodes.push("PLATE_CROP_TOO_SMALL");
  if (sharpness < minSharpness) reasonCodes.push("PLATE_CROP_TOO_BLURRY");
  if (bbox?.x < 0 || bbox?.y < 0 || bbox?.x + width > frameWidth || bbox?.y + height > frameHeight) {
    reasonCodes.push("PLATE_CROP_OUTSIDE_FRAME");
  }

  return {
    accepted: reasonCodes.length === 0,
    width,
    height,
    sharpness,
    reasonCodes: reasonCodes.length ? reasonCodes : ["CROP_QUALITY_ACCEPTABLE"]
  };
}

export function votePlateCandidates(candidates, { minVotes = 3, minConfidence = 0.65 } = {}) {
  const buckets = new Map();

  for (const candidate of candidates) {
    if (!candidate.validFormat || candidate.confidence < minConfidence) continue;
    const existing = buckets.get(candidate.normalizedText) || {
      normalizedText: candidate.normalizedText,
      rawTexts: [],
      votes: 0,
      confidenceSum: 0,
      firstSeenAt: candidate.captureTime,
      lastSeenAt: candidate.captureTime
    };

    existing.rawTexts.push(candidate.rawText);
    existing.votes += 1;
    existing.confidenceSum += candidate.confidence;
    existing.lastSeenAt = candidate.captureTime;
    buckets.set(candidate.normalizedText, existing);
  }

  const winner = [...buckets.values()]
    .filter((item) => item.votes >= minVotes)
    .sort((a, b) => b.votes - a.votes || b.confidenceSum - a.confidenceSum)[0];

  if (!winner) {
    return {
      accepted: false,
      reasonCodes: ["INSUFFICIENT_TEMPORAL_VOTES"],
      candidatesConsidered: candidates.length
    };
  }

  return {
    accepted: true,
    schemaVersion: "anpr-result.v1",
    normalizedText: winner.normalizedText,
    rawTexts: winner.rawTexts,
    votes: winner.votes,
    confidence: Math.round((winner.confidenceSum / winner.votes) * 1000) / 1000,
    firstSeenAt: winner.firstSeenAt,
    lastSeenAt: winner.lastSeenAt,
    reasonCodes: ["VALID_PLATE_FORMAT", "TEMPORAL_VOTE_CONFIRMED"]
  };
}

export async function ocrPlateImage({
  imagePath,
  cameraId,
  trackId = "plate-crop",
  captureTime = new Date().toISOString(),
  command = process.env.ANPR_OCR_COMMAND,
  args = (process.env.ANPR_OCR_ARGS || "--image {imagePath}").split(" ").filter(Boolean),
  voteOptions = {}
}) {
  const commandResult = await runJsonCommand(command, applyArgTemplate(args, { imagePath }), {
    timeoutMs: Number(process.env.ANPR_OCR_TIMEOUT_MS || 30000)
  });
  if (!commandResult.ok) {
    return {
      accepted: false,
      candidates: [],
      reasonCodes: ["OCR_ENGINE_UNAVAILABLE"],
      error: commandResult.error
    };
  }

  const rows = normalizeOcrRows(commandResult.data);
  const candidates = rows.map((row, index) => buildPlateCandidate({
    cameraId,
    trackId: `${trackId}-${index + 1}`,
    rawText: row.text,
    confidence: row.confidence,
    captureTime
  }));

  if (candidates.length === 0) {
    return {
      accepted: false,
      candidates,
      reasonCodes: ["OCR_RETURNED_NO_TEXT"]
    };
  }

  const vote = votePlateCandidates(candidates, voteOptions);
  return {
    ...vote,
    candidates
  };
}

export async function detectPlateCandidates({
  imagePath,
  cameraId,
  trackId,
  frameSize,
  captureTime = new Date().toISOString(),
  command = process.env.ANPR_PLATE_DETECT_COMMAND,
  args = (process.env.ANPR_PLATE_DETECT_ARGS || "--image {imagePath}").split(" ").filter(Boolean)
}) {
  const commandResult = await runJsonCommand(command, applyArgTemplate(args, { imagePath }), {
    timeoutMs: Number(process.env.ANPR_PLATE_DETECT_TIMEOUT_MS || 30000)
  });
  if (!commandResult.ok) {
    return { detections: [], accepted: false, reasonCodes: ["PLATE_DETECTOR_UNAVAILABLE"], error: commandResult.error };
  }

  const detections = normalizePlateDetections(commandResult.data)
    .map((detection) => buildPlateDetection({ cameraId, trackId, detection, frameSize, captureTime }));
  const accepted = detections.filter((detection) => detection.quality.accepted);
  return {
    detections,
    accepted: accepted.length > 0,
    reasonCodes: accepted.length > 0 ? ["PLATE_DETECTOR_CONNECTED", "PLATE_CROP_READY"] : ["NO_ACCEPTABLE_PLATE_CROP"]
  };
}

export async function processVehicleAnprFrame({
  imagePath,
  cameraId,
  vehicleTrackId,
  frameSize,
  captureTime = new Date().toISOString(),
  state = new Map(),
  detector = detectPlateCandidates,
  ocr = ocrPlateImage,
  voteOptions = {},
  privacy = {}
}) {
  const detected = await detector({ imagePath, cameraId, trackId: vehicleTrackId, frameSize, captureTime });
  if (!detected.accepted) return { accepted: false, reasonCodes: detected.reasonCodes, detections: detected.detections || [] };

  const candidates = [];
  for (const detection of detected.detections.filter((item) => item.quality.accepted)) {
    const ocrResult = await ocr({
      imagePath,
      cameraId,
      trackId: vehicleTrackId,
      captureTime,
      voteOptions: { minVotes: 1, minConfidence: voteOptions.minConfidence ?? 0.65 }
    });
    if (ocrResult.reasonCodes?.includes("OCR_ENGINE_UNAVAILABLE")) {
      return { accepted: false, reasonCodes: ["OCR_UNAVAILABLE"], detections: detected.detections };
    }
    candidates.push(...(ocrResult.candidates || []));
    detection.ocr = {
      rawTexts: (ocrResult.candidates || []).map((candidate) => candidate.rawText),
      reasonCodes: ocrResult.reasonCodes || []
    };
  }

  if (candidates.length === 0) return { accepted: false, reasonCodes: ["OCR_RETURNED_NO_TEXT"], detections: detected.detections };
  const key = `${cameraId}:${vehicleTrackId}`;
  const history = [...(state.get(key) || []), ...candidates].slice(-Number(voteOptions.maxHistory || 20));
  state.set(key, history);
  const vote = votePlateCandidates(history, voteOptions);
  return {
    ...vote,
    vehicleTrackId,
    detections: detected.detections,
    candidates,
    maskedText: vote.accepted ? maskPlateValue(vote.normalizedText, privacy) : undefined,
    reasonCodes: vote.accepted ? [...vote.reasonCodes, "ACCEPTED_TEMPORAL_VOTE"] : ["INSUFFICIENT_VOTES", ...vote.reasonCodes]
  };
}

export function maskPlateValue(value, { enabled = true, visiblePrefix = 2, visibleSuffix = 4 } = {}) {
  const text = normalizePlateText(value);
  if (!enabled || text.length <= visiblePrefix + visibleSuffix) return text;
  return `${text.slice(0, visiblePrefix)}${"*".repeat(text.length - visiblePrefix - visibleSuffix)}${text.slice(-visibleSuffix)}`;
}

function normalizeOcrRows(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.results || payload?.detections || [];
  return rows
    .map((row) => ({
      text: row.text ?? row.rawText ?? row.label ?? "",
      confidence: row.confidence ?? row.score ?? row.probability ?? 0
    }))
    .filter((row) => String(row.text).trim());
}

function normalizePlateDetections(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.plates || payload?.detections || [];
  return rows.filter((row) => row.bbox || row.box || row.xyxy);
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

function clampBbox(bbox, frameSize = {}) {
  const frameWidth = Number(frameSize.width ?? Infinity);
  const frameHeight = Number(frameSize.height ?? Infinity);
  const x = Math.max(0, Math.min(frameWidth, bbox.x));
  const y = Math.max(0, Math.min(frameHeight, bbox.y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(0, Math.min(frameWidth - x, bbox.width))),
    height: Math.round(Math.max(0, Math.min(frameHeight - y, bbox.height)))
  };
}

function stableBoxId(bbox) {
  return `${Math.round(bbox.x / 10)}-${Math.round(bbox.y / 10)}-${Math.round(bbox.width / 10)}-${Math.round(bbox.height / 10)}`;
}

function clampConfidence(value) {
  return Math.max(0, Math.min(1, Math.round(Number(value || 0) * 1000) / 1000));
}
