import assert from "node:assert/strict";
import path from "node:path";
import {
  assessPlateCropQuality,
  buildPlateCandidate,
  buildPlateDetection,
  detectPlateCandidates,
  isValidIndianPlate,
  maskPlateValue,
  normalizePlateText,
  ocrPlateImage,
  processVehicleAnprFrame,
  votePlateCandidates
} from "../../edge/analytics/src/anpr.mjs";

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

const plateDetection = buildPlateDetection({
  cameraId: "cam-1",
  trackId: "veh-1",
  frameSize: { width: 640, height: 360 },
  captureTime: "2026-08-26T00:00:05.000Z",
  detection: { bbox: [80, 120, 210, 158], confidence: 0.87, quality: { sharpness: 0.3 } }
});
assert.equal(plateDetection.quality.accepted, true);
assert.equal(plateDetection.bbox.width, 130);
assert.deepEqual(assessPlateCropQuality({
  bbox: { x: 0, y: 0, width: 20, height: 6 },
  frameSize: { width: 640, height: 360 }
}).reasonCodes, ["PLATE_CROP_TOO_SMALL"]);

const detector = await detectPlateCandidates({
  imagePath: path.resolve("tests/fixtures/vehicle-frame.jpg"),
  cameraId: "cam-1",
  trackId: "veh-detector",
  frameSize: { width: 640, height: 360 },
  command: process.execPath,
  args: ["tests/fixtures/mock-plate-detector.mjs", "--image", "{imagePath}"],
  captureTime: "2026-08-26T00:00:06.000Z"
});
assert.equal(detector.accepted, true);
assert.equal(detector.detections.length, 1);
assert(detector.reasonCodes.includes("PLATE_CROP_READY"));

const state = new Map();
let cropPathUsedByOcr = false;
for (let index = 0; index < 3; index += 1) {
  const cropPath = path.resolve("tests/fixtures/plate-crop.jpg");
  const anpr = await processVehicleAnprFrame({
    imagePath: path.resolve("tests/fixtures/vehicle-frame.jpg"),
    cameraId: "cam-1",
    vehicleTrackId: "veh-temporal",
    frameSize: { width: 640, height: 360 },
    state,
    detector: async ({ cameraId, trackId, frameSize, captureTime }) => detectPlateCandidates({
      imagePath: path.resolve("tests/fixtures/vehicle-frame.jpg"),
      cameraId,
      trackId,
      frameSize,
      captureTime,
      command: process.execPath,
      args: ["tests/fixtures/mock-plate-detector.mjs", "--image", "{imagePath}", "--crop", cropPath]
    }),
    ocr: async ({ imagePath, cameraId, trackId, captureTime }) => {
      cropPathUsedByOcr = cropPathUsedByOcr || imagePath === cropPath;
      return {
        candidates: [
          buildPlateCandidate({ cameraId, trackId, rawText: "MH 12 AB 1234", confidence: 0.9, captureTime })
        ],
        reasonCodes: ["OCR_TEXT_EXTRACTED"]
      };
    },
    voteOptions: { minVotes: 3, minConfidence: 0.65 },
    privacy: { enabled: true }
  });
  if (index < 2) assert.equal(anpr.accepted, false);
  else {
    assert.equal(anpr.accepted, true);
    assert.equal(anpr.normalizedText, "MH12AB1234");
    assert.equal(anpr.maskedText, "MH****1234");
    assert(anpr.reasonCodes.includes("ACCEPTED_TEMPORAL_VOTE"));
  }
}
assert.equal(cropPathUsedByOcr, true);

assert.equal(maskPlateValue("MH12AB1234"), "MH****1234");
assert.equal(maskPlateValue("MH12AB1234", { enabled: false }), "MH12AB1234");

console.log("PASS anpr unit");
