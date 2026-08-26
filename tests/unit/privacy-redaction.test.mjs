import assert from "node:assert/strict";
import path from "node:path";
import {
  applyPixelRedaction,
  assertNoBiometricIdentityFields,
  buildFaceCandidate,
  buildPrivacyRedactionPlan,
  detectFaceCandidatesFromImage,
  detectionToPrivacyTarget
} from "../../edge/vision-runtime/src/privacy-redaction.mjs";

const frameSize = { width: 1280, height: 720 };

assert.equal(detectionToPrivacyTarget({ className: "face" }), "FACE");
assert.equal(detectionToPrivacyTarget({ className: "number_plate" }), "PLATE");
assert.equal(detectionToPrivacyTarget({ className: "person" }), null);

const face = buildFaceCandidate({
  cameraId: "cam-1",
  frameTime: "2026-08-26T00:00:00.000Z",
  frameSize,
  detection: { className: "face", confidence: 0.91, bbox: [10, 20, 110, 120] }
});

assert.equal(face.identityRecognition, false);
assert.deepEqual(face.reasonCodes, ["FACE_DETECTED_FOR_PRIVACY_REDACTION", "IDENTITY_RECOGNITION_DISABLED"]);
assert.equal(assertNoBiometricIdentityFields(face), true);

assert.throws(() => assertNoBiometricIdentityFields({ ...face, embedding: [0.1, 0.2] }), /Biometric identity fields/);

const plan = buildPrivacyRedactionPlan({
  frameSize,
  detections: [
    { className: "face", confidence: 0.8, bbox: [4, 5, 70, 80] },
    { className: "license_plate", confidence: 0.75, bbox: [600, 500, 760, 545] },
    { className: "face", confidence: 0.2, bbox: [100, 100, 130, 130] }
  ]
});

assert.equal(plan.redactionRequired, true);
assert.equal(plan.targets.length, 2);
assert(plan.reasonCodes.includes("NO_IDENTITY_EMBEDDINGS_STORED"));
assert.equal(plan.targets[0].action, "BLUR");
assert.equal(plan.targets[0].bbox.x, 0);

const detectOnly = buildPrivacyRedactionPlan({
  frameSize,
  faceBlurEnabled: false,
  detections: [{ className: "face", confidence: 0.8, bbox: [10, 10, 30, 30] }]
});
assert.equal(detectOnly.redactionRequired, false);
assert.equal(detectOnly.targets[0].action, "DETECT_ONLY");

const pixels = Buffer.alloc(8 * 8 * 4);
for (let y = 0; y < 8; y += 1) {
  for (let x = 0; x < 8; x += 1) {
    const index = (y * 8 + x) * 4;
    pixels[index] = (x + y) % 2 === 0 ? 250 : 10;
    pixels[index + 1] = x % 2 === 0 ? 20 : 220;
    pixels[index + 2] = y % 2 === 0 ? 30 : 210;
    pixels[index + 3] = 255;
  }
}
const redacted = applyPixelRedaction({
  pixels,
  width: 8,
  height: 8,
  radius: 1,
  plan: {
    targets: [{ targetType: "FACE", action: "BLUR", method: "GAUSSIAN_BLUR", bbox: { x: 2, y: 2, width: 3, height: 3 }, confidence: 0.9 }]
  }
});
assert.equal(redacted.redactionApplied, true);
assert.equal(redacted.actions.length, 1);
assert.notDeepEqual(redacted.pixels.subarray((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4), pixels.subarray((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4));
assert.deepEqual(redacted.pixels.subarray(0, 4), pixels.subarray(0, 4));

const runtimeFaces = await detectFaceCandidatesFromImage({
  imagePath: path.resolve("tests/fixtures/face-frame.jpg"),
  cameraId: "cam-1",
  frameTime: "2026-08-26T00:00:01.000Z",
  frameSize,
  command: process.execPath,
  args: ["tests/fixtures/mock-face-engine.mjs", "--image", "{imagePath}"]
});
assert.equal(runtimeFaces.candidates.length, 1);
assert.equal(runtimeFaces.candidates[0].identityRecognition, false);
assert(runtimeFaces.reasonCodes.includes("FACE_DETECTION_RUNTIME_CONNECTED"));
assert.equal(runtimeFaces.redactionPlan.redactionRequired, true);

console.log("PASS privacy-redaction unit");
