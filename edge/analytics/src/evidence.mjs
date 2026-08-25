import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = path.resolve("edge/edge-agent/data/evidence");

export function createTextEvidence({ incidentHint, trackEvent, zone }) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const keyframeName = `${incidentHint}-keyframe.txt`;
  const keyframePath = path.join(EVIDENCE_DIR, keyframeName);
  const content = [
    "VigilAI BorderShield evidence placeholder",
    `cameraId=${trackEvent.cameraId}`,
    `trackId=${trackEvent.trackId}`,
    `objectClass=${trackEvent.objectClass}`,
    `zoneId=${zone.zoneId}`,
    `captureTime=${trackEvent.captureTime}`,
    `trajectory=${JSON.stringify(trackEvent.trajectory)}`
  ].join("\n");

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
