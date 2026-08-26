import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export class RollingFrameBuffer {
  constructor({ cameraId, maxDurationMs = 10000, maxFrames = 300 } = {}) {
    this.cameraId = cameraId;
    this.maxDurationMs = Number(maxDurationMs);
    this.maxFrames = Number(maxFrames);
    this.frames = [];
  }

  addFrame(frame) {
    const captureMs = Date.parse(frame.captureTime);
    if (!Number.isFinite(captureMs)) throw new Error("frame.captureTime must be an ISO timestamp");
    this.frames.push({
      ...frame,
      cameraId: frame.cameraId || this.cameraId,
      captureMs
    });
    this.prune(captureMs);
  }

  selectWindow({ eventTime, preEventMs = 5000, postEventMs = 5000 }) {
    const eventMs = Date.parse(eventTime);
    if (!Number.isFinite(eventMs)) throw new Error("eventTime must be an ISO timestamp");
    const startMs = eventMs - Number(preEventMs);
    const endMs = eventMs + Number(postEventMs);
    return this.frames.filter((frame) => frame.captureMs >= startMs && frame.captureMs <= endMs);
  }

  prune(nowMs = Date.now()) {
    const cutoffMs = nowMs - this.maxDurationMs;
    this.frames = this.frames
      .filter((frame) => frame.captureMs >= cutoffMs)
      .slice(-this.maxFrames);
  }
}

export function buildFfmpegImageSequenceArgs({
  inputPattern,
  outputPath,
  fps = 8,
  codec = "libx264"
}) {
  if (!inputPattern || !outputPath) throw new Error("inputPattern and outputPath are required");
  return [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
    "-an",
    "-c:v",
    codec,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];
}

export async function runFfmpegClip({
  ffmpeg = process.env.FFMPEG_BIN || "ffmpeg",
  args,
  timeoutMs = 30000
}) {
  if (!Array.isArray(args) || args.length === 0) throw new Error("ffmpeg args must be a non-empty array");
  const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, timedOut: true, stderr: stderr.trim() });
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: error.message, stderr: stderr.trim() });
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stderr: stderr.trim() });
    });
  });
  return result;
}

export function writeFrameSequence({ frames, directory, prefix = "frame" }) {
  fs.mkdirSync(directory, { recursive: true });
  return frames.map((frame, index) => {
    const sourcePath = filePathFromUri(frame.uri);
    const targetPath = path.join(directory, `${prefix}-${String(index + 1).padStart(6, "0")}${path.extname(sourcePath) || ".png"}`);
    fs.copyFileSync(sourcePath, targetPath);
    return targetPath;
  });
}

function filePathFromUri(uri) {
  if (!String(uri).startsWith("file://")) throw new Error("only file:// frame URIs are supported");
  return decodeURIComponent(String(uri).replace("file://", ""));
}
