import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const python = process.env.PYTHON_BIN || "python";
const probe = await run(python, ["-c", "import cv2; print(cv2.__version__)"]);
if (probe.code !== 0) {
  console.log("SKIP python-runtime-cli unit: python/opencv not available");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bordershield-python-cli-"));
try {
  const imagePath = path.join(tmp, "synthetic-plate.ppm");
  writeSyntheticPpm(imagePath);

  const face = await run(python, ["edge/vision-runtime/python/opencv_face_runtime.py", "--image", imagePath]);
  assert.equal(face.code, 0, `face runtime should exit cleanly: ${face.stderr}`);
  const faceJson = JSON.parse(face.stdout);
  assert(Array.isArray(faceJson.faces), "face runtime should emit faces array");

  const plate = await run(python, ["edge/analytics/python/opencv_plate_detector.py", "--image", imagePath]);
  assert.equal(plate.code, 0, `plate runtime should exit cleanly: ${plate.stderr}`);
  const plateJson = JSON.parse(plate.stdout);
  assert(Array.isArray(plateJson.plates), "plate runtime should emit plates array");
  for (const candidate of plateJson.plates) {
    assert(Array.isArray(candidate.bbox), "plate candidate should include bbox");
    assert.equal(typeof candidate.confidence, "number", "plate candidate should include numeric confidence");
    assert(!("text" in candidate), "plate localizer must not fabricate OCR text");
  }

  console.log("PASS python-runtime-cli unit");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function writeSyntheticPpm(filePath) {
  const width = 320;
  const height = 180;
  const pixels = Buffer.alloc(width * height * 3, 220);
  fillRect(pixels, width, 95, 74, 130, 34, [245, 245, 245]);
  fillRect(pixels, width, 100, 80, 120, 22, [20, 20, 20]);
  fillRect(pixels, width, 108, 85, 18, 10, [245, 245, 245]);
  fillRect(pixels, width, 150, 85, 18, 10, [245, 245, 245]);
  fillRect(pixels, width, 190, 85, 18, 10, [245, 245, 245]);
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
}

function fillRect(pixels, width, x, y, rectWidth, rectHeight, color) {
  for (let yy = y; yy < y + rectHeight; yy += 1) {
    for (let xx = x; xx < x + rectWidth; xx += 1) {
      const index = (yy * width + xx) * 3;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
    }
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: 1, stdout: "", stderr: error.message });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.once("exit", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}
