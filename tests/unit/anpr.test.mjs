import assert from "node:assert/strict";
import { buildPlateCandidate, isValidIndianPlate, normalizePlateText, votePlateCandidates } from "../../edge/analytics/src/anpr.mjs";

assert.equal(normalizePlateText(" mh 12 ab 1234 "), "MH12AB1234");
assert.equal(isValidIndianPlate("MH12AB1234"), true);
assert.equal(isValidIndianPlate("NOTAPLATE"), false);

const candidates = [
  buildPlateCandidate({ cameraId: "cam-1", trackId: "veh-1", rawText: "MH 12 AB 1234", confidence: 0.72, captureTime: "2026-08-26T00:00:00.000Z" }),
  buildPlateCandidate({ cameraId: "cam-1", trackId: "veh-1", rawText: "MH12AB1234", confidence: 0.82, captureTime: "2026-08-26T00:00:01.000Z" }),
  buildPlateCandidate({ cameraId: "cam-1", trackId: "veh-1", rawText: "MH-12-AB-1234", confidence: 0.76, captureTime: "2026-08-26T00:00:02.000Z" }),
  buildPlateCandidate({ cameraId: "cam-1", trackId: "veh-1", rawText: "weak", confidence: 0.99, captureTime: "2026-08-26T00:00:03.000Z" })
];

const result = votePlateCandidates(candidates, { minVotes: 3, minConfidence: 0.65 });
assert.equal(result.accepted, true);
assert.equal(result.normalizedText, "MH12AB1234");
assert.equal(result.votes, 3);
assert.deepEqual(result.reasonCodes, ["VALID_PLATE_FORMAT", "TEMPORAL_VOTE_CONFIRMED"]);

const weak = votePlateCandidates(candidates.slice(0, 2), { minVotes: 3, minConfidence: 0.65 });
assert.equal(weak.accepted, false);
assert.deepEqual(weak.reasonCodes, ["INSUFFICIENT_TEMPORAL_VOTES"]);

console.log("PASS anpr unit");
