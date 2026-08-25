import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function createTextEvidence({ incidentHint, trackEvent, zone }) {
  fs.mkdirSync(evidenceDir(), { recursive: true });

  const keyframeName = `${incidentHint}-keyframe.svg`;
  const keyframePath = path.join(evidenceDir(), keyframeName);
  const content = buildEvidenceSvg({ trackEvent, zone });

  fs.writeFileSync(keyframePath, content);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");

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
    keyframeUri: `file://${keyframePath.replaceAll("\\", "/")}`,
    clipUri: `file://${keyframePath.replaceAll("\\", "/")}`
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

function evidenceDir() {
  return path.resolve(process.env.EVIDENCE_DIR || "edge/edge-agent/data/evidence");
}
