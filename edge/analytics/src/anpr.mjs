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

function clampConfidence(value) {
  return Math.max(0, Math.min(1, Math.round(Number(value || 0) * 1000) / 1000));
}
