import assert from "node:assert/strict";
import path from "node:path";
import { buildPlateCandidate, isValidIndianPlate, normalizePlateText, ocrPlateImage, votePlateCandidates } from "../../edge/analytics/src/anpr.mjs";

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

const ocr = await ocrPlateImage({
  imagePath: path.resolve("tests/fixtures/plate-crop.jpg"),
  cameraId: "cam-1",
  trackId: "veh-ocr",
  command: process.execPath,
  args: ["tests/fixtures/mock-ocr-engine.mjs", "--image", "{imagePath}"],
  voteOptions: { minVotes: 3, minConfidence: 0.65 },
  captureTime: "2026-08-26T00:00:04.000Z"
});
assert.equal(ocr.accepted, true);
assert.equal(ocr.normalizedText, "MH12AB1234");
assert.equal(ocr.candidates.length, 3);

console.log("PASS anpr unit");
