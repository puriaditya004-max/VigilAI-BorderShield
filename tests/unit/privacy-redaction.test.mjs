import assert from "node:assert/strict";
import {
  assertNoBiometricIdentityFields,
  buildFaceCandidate,
  buildPrivacyRedactionPlan,
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

console.log("PASS privacy-redaction unit");
