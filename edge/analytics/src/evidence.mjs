import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { encryptEvidenceBuffer, hasEvidenceEncryptionKey } from "../../../services/evidence-service/src/encryption.mjs";
import { applyPixelRedaction } from "../../vision-runtime/src/privacy-redaction.mjs";
import { buildFfmpegImageSequenceArgs, runFfmpegClip, writeFrameSequence } from "./media-buffer.mjs";

export function createTextEvidence({ incidentHint, trackEvent, zone }) {
  fs.mkdirSync(evidenceDir(), { recursive: true });

  const encrypted = hasEvidenceEncryptionKey();
  const keyframeName = `${incidentHint}-keyframe.svg${encrypted ? ".enc" : ""}`;
  const keyframePath = path.join(evidenceDir(), keyframeName);
  const content = buildEvidenceSvg({ trackEvent, zone });
  const payload = encrypted ? encryptEvidenceBuffer(Buffer.from(content, "utf8")) : Buffer.from(content, "utf8");

  fs.writeFileSync(keyframePath, payload);
  const sha256 = crypto.createHash("sha256").update(payload).digest("hex");

  return {
    schemaVersion: "evidence-manifest.v1",
    manifestId: `manifest-${incidentHint}`,
    incidentId: incidentHint,
    createdAt: new Date().toISOString(),
    assets: [
      {
        kind: "KEYFRAME",
        uri: `file://${keyframePath.replaceAll("\\", "/")}`,
        sha256
      }
    ],
    sha256,
    metadata: {
      evidenceMode: "SVG_FIXTURE",
      redactions: []
    },
    keyframeUri: `file://${keyframePath.replaceAll("\\", "/")}`,
    clipUri: `file://${keyframePath.replaceAll("\\", "/")}`
  };
}

export function createEvidenceForTrack({ incidentHint, trackEvent, zone, preferRealFrame = true }) {
  if (preferRealFrame && trackEvent.frame?.uri?.startsWith("file://")) {
    return createFrameEvidence({ incidentHint, trackEvent, zone });
  }
  return createTextEvidence({ incidentHint, trackEvent, zone });
}

export function createFrameEvidence({ incidentHint, trackEvent, zone }) {
  fs.mkdirSync(evidenceDir(), { recursive: true });
  const sourcePath = filePathFromUri(trackEvent.frame?.uri);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`frame evidence source is missing: ${trackEvent.frame?.uri}`);
  }

  const encrypted = hasEvidenceEncryptionKey();
  const extension = path.extname(sourcePath) || ".jpg";
  const keyframeName = `${incidentHint}-keyframe${extension}${encrypted ? ".enc" : ""}`;
  const keyframePath = path.join(evidenceDir(), keyframeName);
  const sourcePayload = fs.readFileSync(sourcePath);
  const payload = encrypted ? encryptEvidenceBuffer(sourcePayload) : sourcePayload;
  fs.writeFileSync(keyframePath, payload);
  const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
  const uri = `file://${keyframePath.replaceAll("\\", "/")}`;

  return {
    schemaVersion: "evidence-manifest.v1",
    manifestId: `manifest-${incidentHint}`,
    incidentId: incidentHint,
    createdAt: new Date().toISOString(),
    assets: [
      {
        kind: "KEYFRAME",
        uri,
        sha256,
        contentType: encrypted ? "application/octet-stream" : contentTypeForExtension(extension)
      }
    ],
    sha256,
    metadata: {
      evidenceMode: encrypted ? "REAL_FRAME_KEYFRAME_ENCRYPTED" : "REAL_FRAME_KEYFRAME",
      sourceFrame: {
        uri: trackEvent.frame.uri,
        sha256: trackEvent.frame.sha256 || null
      },
      frame: trackEvent.coordinateSpace?.canonical || null,
      zoneId: zone.zoneId,
      redactions: [],
      clipStatus: "NOT_AVAILABLE"
    },
    keyframeUri: uri,
    clipUri: null
  };
}

export function attachRedactionMetadata(evidence, redactions = []) {
  return {
    ...evidence,
    metadata: {
      ...(evidence.metadata || {}),
      redactions: redactions.map((redaction) => ({
        targetType: redaction.targetType,
        action: redaction.action,
        method: redaction.method,
        bbox: redaction.bbox,
        confidence: redaction.confidence,
        reasonCodes: redaction.reasonCodes || []
      }))
    }
  };
}

export function attachClipEvidence(evidence, clipManifest) {
  if (!clipManifest?.clipUri) return evidence;
  return {
    ...evidence,
    assets: [
      ...(evidence.assets || []),
      ...(clipManifest.assets || [])
    ],
    clipUri: clipManifest.clipUri,
    metadata: {
      ...(evidence.metadata || {}),
      clipStatus: "AVAILABLE",
      clipEvidenceMode: clipManifest.metadata?.evidenceMode,
      clipFrameCount: clipManifest.metadata?.frameCount,
      sourceFrameWindow: clipManifest.metadata?.sourceFrameWindow
    }
  };
}

export function markClipUnavailable(evidence, reasonCode) {
  return {
    ...evidence,
    clipUri: null,
    metadata: {
      ...(evidence.metadata || {}),
      clipStatus: "NOT_AVAILABLE",
      clipReasonCodes: [reasonCode]
    }
  };
}

export function createPngEvidence({
  incidentHint,
  trackEvent,
  zone,
  frame,
  privacyPlan
}) {
  fs.mkdirSync(evidenceDir(), { recursive: true });
  const width = Number(frame?.width || trackEvent.coordinateSpace?.canonical?.width || 1280);
  const height = Number(frame?.height || trackEvent.coordinateSpace?.canonical?.height || 720);
  const basePixels = frame?.pixels ? Buffer.from(frame.pixels) : buildSyntheticEvidencePixels({ width, height, trackEvent, zone });
  const redaction = applyPixelRedaction({
    pixels: basePixels,
    width,
    height,
    plan: privacyPlan || { targets: [] }
  });
  const annotated = drawEvidenceOverlay({ pixels: redaction.pixels, width, height, trackEvent, zone });
  const png = encodePngRgba({ width, height, pixels: annotated });
  const encrypted = hasEvidenceEncryptionKey();
  const keyframeName = `${incidentHint}-keyframe.png${encrypted ? ".enc" : ""}`;
  const keyframePath = path.join(evidenceDir(), keyframeName);
  const payload = encrypted ? encryptEvidenceBuffer(png) : png;

  fs.writeFileSync(keyframePath, payload);
  const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
  const manifest = {
    schemaVersion: "evidence-manifest.v1",
    manifestId: `manifest-${incidentHint}`,
    incidentId: incidentHint,
    createdAt: new Date().toISOString(),
    assets: [
      {
        kind: "KEYFRAME",
        uri: `file://${keyframePath.replaceAll("\\", "/")}`,
        sha256,
        contentType: encrypted ? "application/octet-stream" : "image/png"
      }
    ],
    sha256,
    metadata: {
      evidenceMode: encrypted ? "PNG_KEYFRAME_ENCRYPTED" : "PNG_KEYFRAME",
      redactions: redaction.actions,
      frame: { width, height },
      clipStatus: "NOT_AVAILABLE"
    },
    keyframeUri: `file://${keyframePath.replaceAll("\\", "/")}`,
    clipUri: null
  };

  return attachRedactionMetadata(manifest, redaction.actions);
}

export async function createMp4ClipEvidence({
  incidentHint,
  trackEvent,
  frames,
  fps = 8,
  ffmpeg = process.env.FFMPEG_BIN || "ffmpeg",
  runClip = runFfmpegClip
}) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error("at least one frame is required to create MP4 clip evidence");
  }

  const root = evidenceDir();
  fs.mkdirSync(root, { recursive: true });
  const sequenceDir = path.join(root, `${incidentHint}-frames`);
  const sequencePaths = writeFrameSequence({ frames, directory: sequenceDir });
  const sequenceExtension = path.extname(sequencePaths[0]) || ".png";
  const inputPattern = path.join(sequenceDir, `frame-%06d${sequenceExtension}`);
  const clipPath = path.join(root, `${incidentHint}-clip.mp4`);
  const args = buildFfmpegImageSequenceArgs({ inputPattern, outputPath: clipPath, fps });
  const result = await runClip({ ffmpeg, args });
  if (!result.ok) {
    throw new Error(`FFmpeg clip generation failed: ${result.stderr || result.error || "unknown error"}`);
  }

  const encrypted = hasEvidenceEncryptionKey();
  let finalClipPath = clipPath;
  let payload = fs.readFileSync(clipPath);
  if (encrypted) {
    finalClipPath = `${clipPath}.enc`;
    payload = encryptEvidenceBuffer(payload);
    fs.writeFileSync(finalClipPath, payload);
  }
  const sha256 = crypto.createHash("sha256").update(payload).digest("hex");

  return {
    schemaVersion: "evidence-manifest.v1",
    manifestId: `manifest-${incidentHint}`,
    incidentId: incidentHint,
    createdAt: new Date().toISOString(),
    assets: [
      {
        kind: "CLIP",
        uri: `file://${finalClipPath.replaceAll("\\", "/")}`,
        sha256,
        contentType: encrypted ? "application/octet-stream" : "video/mp4"
      }
    ],
    sha256,
    metadata: {
      evidenceMode: encrypted ? "MP4_CLIP_ENCRYPTED" : "MP4_CLIP",
      clipStatus: "AVAILABLE",
      frameCount: frames.length,
      fps,
      sourceFrameWindow: {
        firstCaptureTime: frames[0].captureTime,
        lastCaptureTime: frames.at(-1).captureTime
      }
    },
    keyframeUri: frames.find((frame) => frame.uri)?.uri || null,
    clipUri: `file://${finalClipPath.replaceAll("\\", "/")}`
  };
}

function buildEvidenceSvg({ trackEvent, zone }) {
  const width = 1280;
  const height = 720;
  const { bbox } = trackEvent;
  const points = trackEvent.trajectory.map((p) => `${p.x},${p.y}`).join(" ");
  const label = `${trackEvent.objectClass} ${trackEvent.trackId} ${Math.round(trackEvent.confidence * 100)}%`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#111820"/>
  <rect x="0" y="0" width="100%" height="62" fill="#18222b"/>
  <text x="24" y="39" fill="#e8f1ee" font-family="Arial" font-size="24" font-weight="700">VigilAI BorderShield Evidence</text>
  <text x="24" y="692" fill="#9fb0aa" font-family="Arial" font-size="18">camera=${escapeXml(trackEvent.cameraId)} zone=${escapeXml(zone.zoneId)} captured=${escapeXml(trackEvent.captureTime)}</text>
  <line x1="${zone.line.a.x}" y1="${zone.line.a.y}" x2="${zone.line.b.x}" y2="${zone.line.b.y}" stroke="#f4b04f" stroke-width="6" stroke-dasharray="16 10"/>
  <polyline points="${points}" fill="none" stroke="#45c084" stroke-width="5"/>
  <rect x="${bbox.x}" y="${bbox.y}" width="${bbox.width}" height="${bbox.height}" fill="none" stroke="#ef626c" stroke-width="5"/>
  <rect x="${bbox.x}" y="${Math.max(70, bbox.y - 38)}" width="310" height="30" fill="#ef626c"/>
  <text x="${bbox.x + 10}" y="${Math.max(92, bbox.y - 17)}" fill="#101214" font-family="Arial" font-size="18" font-weight="700">${escapeXml(label)}</text>
</svg>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function filePathFromUri(uri) {
  if (!String(uri || "").startsWith("file://")) throw new Error("frame evidence requires a file:// URI");
  return decodeURIComponent(String(uri).replace("file://", ""));
}

function contentTypeForExtension(extension) {
  const normalized = String(extension || "").toLowerCase();
  if (normalized === ".png") return "image/png";
  if (normalized === ".webp") return "image/webp";
  return "image/jpeg";
}

function buildSyntheticEvidencePixels({ width, height }) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      pixels[index] = 18;
      pixels[index + 1] = 26 + Math.round((y / Math.max(1, height)) * 24);
      pixels[index + 2] = 32 + Math.round((x / Math.max(1, width)) * 20);
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function drawEvidenceOverlay({ pixels, width, height, trackEvent, zone }) {
  const output = Buffer.from(pixels);
  drawLine(output, width, height, zone.line.a.x, zone.line.a.y, zone.line.b.x, zone.line.b.y, [244, 176, 79, 255]);
  drawRect(output, width, height, trackEvent.bbox, [239, 98, 108, 255]);
  for (let index = 1; index < trackEvent.trajectory.length; index += 1) {
    const a = trackEvent.trajectory[index - 1];
    const b = trackEvent.trajectory[index];
    drawLine(output, width, height, a.x, a.y, b.x, b.y, [69, 192, 132, 255]);
  }
  return output;
}

function drawRect(pixels, width, height, bbox, color) {
  const x1 = Math.round(bbox.x);
  const y1 = Math.round(bbox.y);
  const x2 = Math.round(bbox.x + bbox.width);
  const y2 = Math.round(bbox.y + bbox.height);
  drawLine(pixels, width, height, x1, y1, x2, y1, color);
  drawLine(pixels, width, height, x2, y1, x2, y2, color);
  drawLine(pixels, width, height, x2, y2, x1, y2, color);
  drawLine(pixels, width, height, x1, y2, x1, y1, color);
}

function drawLine(pixels, width, height, x1, y1, x2, y2, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + ((x2 - x1) * step) / steps);
    const y = Math.round(y1 + ((y2 - y1) * step) / steps);
    setPixel(pixels, width, height, x, y, color);
  }
}

function setPixel(pixels, width, height, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (y * width + x) * 4;
  for (let channel = 0; channel < 4; channel += 1) pixels[index + channel] = color[channel];
}

function encodePngRgba({ width, height, pixels }) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineStart = y * (width * 4 + 1);
    scanlines[scanlineStart] = 0;
    pixels.copy(scanlines, scanlineStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function evidenceDir() {
  return path.resolve(process.env.EVIDENCE_DIR || "edge/edge-agent/data/evidence");
}
