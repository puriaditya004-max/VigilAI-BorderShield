import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { attachClipEvidence, attachRedactionMetadata, createEvidenceForTrack, createMp4ClipEvidence, markClipUnavailable } from "./evidence.mjs";
import { buildAnalyticsIncident } from "./incident-builder.mjs";
import {
  detectCrowdFormation,
  detectLoitering,
  detectRepeatedBoundaryApproach,
  detectSuddenSpeedChange
} from "./suspicious-activity.mjs";
import { detectFrameTamper, detectNightMovement } from "./night-watch.mjs";
import { RollingFrameBuffer } from "./media-buffer.mjs";
import { detectPlateCandidates, processVehicleAnprFrame } from "./anpr.mjs";
import { buildIntrusionIncident, crossedFence, FenceIncidentPolicy } from "./virtual-fence.mjs";
import { detectFaceCandidatesFromImage } from "../../vision-runtime/src/privacy-redaction.mjs";
import { registerCamera, sendEvidence, sendHealth, sendIncident } from "./control-client.mjs";
import { enqueueIncident, replayOutbox } from "../../edge-agent/src/outbox.mjs";

const API_BASE = process.env.CONTROL_API_URL || "http://localhost:7080";
const cameraConfigPath = process.env.CAMERA_CONFIG || "edge/edge-agent/config/camera.json";
const zonesConfigPath = process.env.ZONES_CONFIG || "edge/analytics/config/zones.json";
const TRAJECTORY_HISTORY_POINTS = Number(process.env.TRACK_TRAJECTORY_HISTORY_POINTS || 20);
const TRACK_STATE_TTL_MS = Number(process.env.ANALYTICS_TRACK_STATE_TTL_MS || 5 * 60 * 1000);
const REGISTER_BACKOFF_BASE_MS = Number(process.env.EDGE_REGISTER_BACKOFF_BASE_MS || 2000);
const REGISTER_BACKOFF_MAX_MS = Number(process.env.EDGE_REGISTER_BACKOFF_MAX_MS || 60000);
const REPLAY_BACKOFF_BASE_MS = Number(process.env.EDGE_OUTBOX_REPLAY_BACKOFF_BASE_MS || 2000);
const REPLAY_BACKOFF_MAX_MS = Number(process.env.EDGE_OUTBOX_REPLAY_BACKOFF_MAX_MS || 30000);

export async function runTrackBridge({
  input = process.stdin,
  endpoint = API_BASE,
  cameraConfig = cameraConfigPath,
  zonesConfig = zonesConfigPath,
  createClipEvidence = createMp4ClipEvidence
} = {}) {
  const camera = JSON.parse(fs.readFileSync(cameraConfig, "utf8"));
  const zones = JSON.parse(fs.readFileSync(zonesConfig, "utf8"));
  const registrationBackoff = createBackoffState({ baseMs: REGISTER_BACKOFF_BASE_MS, maxMs: REGISTER_BACKOFF_MAX_MS });
  const replayBackoff = createBackoffState({ baseMs: REPLAY_BACKOFF_BASE_MS, maxMs: REPLAY_BACKOFF_MAX_MS });
  const registration = { value: await tryRegisterCamera({ endpoint, camera, backoff: registrationBackoff }) };
  if (registration.value?.deviceKey) {
    await sendHealth({ endpoint, camera, deviceKey: registration.value.deviceKey }).catch((error) => {
      console.error(`Camera health skipped: ${error.message}`);
    });
  }

  const emitted = [];
  const crossingState = new Map();
  const trajectoryHistory = new Map();
  const latestTracks = new Map();
  const frameBuffers = new Map();
  const analyticsCooldowns = new Map();
  const anprState = new Map();
  const fencePolicy = new FenceIncidentPolicy();
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;

    let trackEvent;
    try {
      trackEvent = JSON.parse(trimmed);
    } catch (error) {
      console.error(`Skipping invalid TrackEvent line: ${error.message}`);
      continue;
    }

    if (trackEvent.schemaVersion !== "track-event.v1") continue;
    const accumulatedTrackEvent = accumulateTrackTrajectory(trajectoryHistory, trackEvent);
    rememberTrackFrame(frameBuffers, accumulatedTrackEvent);
    latestTracks.set(trackKey(accumulatedTrackEvent), accumulatedTrackEvent);
    expireTrackState({ trajectoryHistory, latestTracks, now: Date.parse(accumulatedTrackEvent.captureTime) || Date.now() });
    const matchingZones = zones.filter((zone) => zone.cameraId === accumulatedTrackEvent.cameraId);

    for (const zone of matchingZones) {
      const key = `${accumulatedTrackEvent.trackId}:${zone.zoneId}`;
      if (!crossedFence(accumulatedTrackEvent.trajectory, zone)) {
        crossingState.delete(key);
        continue;
      }

      const count = (crossingState.get(key) || 0) + 1;
      crossingState.set(key, count);
      if (count < (zone.persistenceFrames || 1)) continue;

      crossingState.delete(key);
      const decision = fencePolicy.evaluate({ trackEvent: accumulatedTrackEvent, zone });
      if (!decision.allowed) continue;

      const incidentHint = `inc-${accumulatedTrackEvent.cameraId}-${accumulatedTrackEvent.trackId}-${Date.parse(accumulatedTrackEvent.captureTime)}`;
      const evidence = await createEvidenceWithPrivacy({ incidentHint, trackEvent: accumulatedTrackEvent, zone, frameBuffers, createClipEvidence });
      const incident = buildIntrusionIncident({ trackEvent: accumulatedTrackEvent, zone, evidence, decision });

      await publishIncident({ endpoint, incident, evidence, camera, registration, registrationBackoff, replayBackoff });
      emitted.push(incident);
    }

    const analyticsIncidents = await evaluateIntegratedAnalytics({
      trackEvent: accumulatedTrackEvent,
      zones: matchingZones,
      latestTracks: Array.from(latestTracks.values()).filter((track) => track.cameraId === accumulatedTrackEvent.cameraId),
      cooldowns: analyticsCooldowns,
      frameBuffers,
      createClipEvidence
    });
    for (const { incident, evidence } of analyticsIncidents) {
      await publishIncident({ endpoint, incident, evidence, camera, registration, registrationBackoff, replayBackoff });
      emitted.push(incident);
    }

    const anprIncidents = await evaluateAnprAnalytics({
      trackEvent: accumulatedTrackEvent,
      zones: matchingZones,
      state: anprState,
      cooldowns: analyticsCooldowns,
      frameBuffers,
      createClipEvidence
    });
    for (const { incident, evidence } of anprIncidents) {
      await publishIncident({ endpoint, incident, evidence, camera, registration, registrationBackoff, replayBackoff });
      emitted.push(incident);
    }
  }

  return emitted;
}

export async function evaluateAnprAnalytics({
  trackEvent,
  zones,
  state = new Map(),
  cooldowns = new Map(),
  now = Date.parse(trackEvent.captureTime) || Date.now(),
  frameBuffers = new Map(),
  createClipEvidence = createMp4ClipEvidence
}) {
  if (trackEvent.objectClass !== "VEHICLE" || !trackEvent.frame?.uri) return [];
  const imagePath = filePathFromUri(trackEvent.frame.uri);
  const incidents = [];

  for (const zone of zones) {
    const config = zone.analytics?.anpr;
    if (!config?.enabled) continue;
    const result = await processVehicleAnprFrame({
      imagePath,
      cameraId: trackEvent.cameraId,
      vehicleTrackId: trackEvent.trackId,
      frameSize: trackEvent.coordinateSpace?.canonical || config.frameSize || { width: 1280, height: 720 },
      captureTime: trackEvent.captureTime,
      state,
      voteOptions: config.voteOptions || {},
      privacy: config.privacy || {}
    });
    if (!result.accepted) continue;

    const decision = {
      detected: true,
      type: "ANPR_CANDIDATE",
      cameraId: trackEvent.cameraId,
      trackId: trackEvent.trackId,
      zoneId: zone.zoneId,
      severity: config.severity || "LOW",
      confidence: result.confidence,
      reasonCodes: [...result.reasonCodes, `RULE_VERSION_${zone.analytics?.ruleVersion || "analytics.v1"}`],
      metrics: {
        votes: result.votes,
        candidatesConsidered: state.get(`${trackEvent.cameraId}:${trackEvent.trackId}`)?.length || 0
      }
    };
    if (isCoolingDown(cooldowns, decision, now)) continue;
    rememberCooldown(cooldowns, decision, zone, now);

    const incidentHint = `inc-${trackEvent.cameraId}-anpr-${trackEvent.trackId}-${now}`;
    let evidence = await createEvidenceWithPrivacy({ incidentHint, trackEvent, zone, frameBuffers, createClipEvidence });
    evidence = attachRedactionMetadata(evidence, [
      ...(evidence.metadata?.redactions || []),
      ...plateRedactionsFromAnprResult(result, config.privacy || {})
    ]);
    evidence.metadata = {
      ...(evidence.metadata || {}),
      anpr: {
        vehicleTrackId: result.vehicleTrackId,
        maskedText: result.maskedText,
        votes: result.votes,
        confidence: result.confidence,
        reasonCodes: result.reasonCodes,
        rawTextRetained: config.retainRawText === true
      }
    };
    if (config.retainRawText === true) {
      evidence.metadata.anpr.rawTexts = result.rawTexts;
    }

    incidents.push({
      decision,
      evidence,
      incident: buildAnalyticsIncident({
        cameraId: trackEvent.cameraId,
        zoneId: zone.zoneId,
        trackId: trackEvent.trackId,
        decision,
        evidence,
        captureTime: trackEvent.captureTime
      })
    });
  }

  return incidents;
}

export async function evaluateIntegratedAnalytics({
  trackEvent,
  zones,
  latestTracks = [],
  cooldowns = new Map(),
  now = Date.parse(trackEvent.captureTime) || Date.now(),
  frameBuffers = new Map(),
  createClipEvidence = createMp4ClipEvidence
}) {
  const incidents = [];
  for (const zone of zones) {
    for (const decision of analyticsDecisions({ trackEvent, zone, latestTracks })) {
      if (!decision.detected || isCoolingDown(cooldowns, decision, now)) continue;
      rememberCooldown(cooldowns, decision, zone, now);
      const incidentHint = `inc-${trackEvent.cameraId}-${String(decision.type).toLowerCase()}-${trackEvent.trackId || "frame"}-${now}`;
      const evidence = await createEvidenceWithPrivacy({ incidentHint, trackEvent, zone, frameBuffers, createClipEvidence });
      incidents.push({
        decision,
        evidence,
        incident: buildAnalyticsIncident({
          cameraId: trackEvent.cameraId,
          zoneId: decision.zoneId || zone.zoneId,
          trackId: trackEvent.trackId,
          decision,
          evidence,
          captureTime: trackEvent.captureTime
        })
      });
    }
  }
  return incidents;
}

async function createEvidenceWithPrivacy({ incidentHint, trackEvent, zone, frameBuffers = new Map(), createClipEvidence = createMp4ClipEvidence }) {
  let evidence = createEvidenceForTrack({ incidentHint, trackEvent, zone });
  evidence = await attachBufferedClipIfAvailable({ evidence, incidentHint, trackEvent, frameBuffers, createClipEvidence });
  const config = zone.analytics?.privacy || {};
  const faceConfig = config.face || {};
  const plateConfig = config.plate || {};
  const enabled = config.enabled === true || faceConfig.enabled === true || plateConfig.enabled === true;
  if (!enabled || !trackEvent.frame?.uri?.startsWith("file://")) return evidence;

  const imagePath = filePathFromUri(trackEvent.frame.uri);
  const frameSize = trackEvent.coordinateSpace?.canonical || config.frameSize || { width: 1280, height: 720 };
  const privacyMetadata = { ...(evidence.metadata?.privacy || {}) };
  const redactions = [...(evidence.metadata?.redactions || [])];

  if (config.enabled === true || faceConfig.enabled === true) {
    const faceResult = await detectFaceCandidatesFromImage({
      imagePath,
      cameraId: trackEvent.cameraId,
      frameTime: trackEvent.captureTime,
      frameSize,
      command: faceConfig.command || process.env.FACE_DETECT_COMMAND,
      args: faceConfig.args
    });

    redactions.push(...(faceResult.redactionPlan?.targets || []));
    privacyMetadata.faceDetection = {
      enabled: true,
      detectorConnected: !faceResult.reasonCodes?.includes("FACE_DETECTOR_UNAVAILABLE"),
      candidates: faceResult.candidates.length,
      identityRecognition: false,
      reasonCodes: faceResult.reasonCodes || [],
      error: faceResult.error || undefined
    };
  }

  if (config.enabled === true || plateConfig.enabled === true) {
    const plateResult = await detectPlateCandidates({
      imagePath,
      cameraId: trackEvent.cameraId,
      trackId: trackEvent.trackId,
      frameSize,
      captureTime: trackEvent.captureTime,
      command: plateConfig.command || process.env.ANPR_PLATE_DETECT_COMMAND,
      args: plateConfig.args
    });

    redactions.push(...plateRedactionsFromDetections(plateResult.detections || [], plateConfig));
    privacyMetadata.plateDetection = {
      enabled: true,
      detectorConnected: !plateResult.reasonCodes?.includes("PLATE_DETECTOR_UNAVAILABLE"),
      candidates: (plateResult.detections || []).filter((detection) => detection.quality?.accepted).length,
      reasonCodes: plateResult.reasonCodes || [],
      error: plateResult.error || undefined
    };
  }

  evidence = attachRedactionMetadata(evidence, dedupeRedactions(redactions));
  evidence.metadata = {
    ...(evidence.metadata || {}),
    privacy: privacyMetadata
  };
  return evidence;
}

async function attachBufferedClipIfAvailable({ evidence, incidentHint, trackEvent, frameBuffers, createClipEvidence }) {
  if (!trackEvent.frame?.uri?.startsWith("file://")) return evidence;
  const buffer = frameBuffers.get(trackEvent.cameraId);
  if (!buffer) return markClipUnavailable(evidence, "FRAME_BUFFER_UNAVAILABLE");

  const frames = buffer.selectWindow({
    eventTime: trackEvent.captureTime,
    preEventMs: Number(process.env.CLIP_PRE_EVENT_MS || 5000),
    postEventMs: Number(process.env.CLIP_POST_EVENT_MS || 5000)
  });
  const minFrames = Number(process.env.CLIP_MIN_FRAMES || 2);
  if (frames.length < minFrames) return markClipUnavailable(evidence, "INSUFFICIENT_BUFFERED_FRAMES");

  try {
    const clip = await createClipEvidence({
      incidentHint,
      trackEvent,
      frames,
      fps: Number(process.env.CLIP_FPS || 8)
    });
    return attachClipEvidence(evidence, clip);
  } catch (error) {
    const reason = String(error?.message || "").includes("ENOENT") ? "FFMPEG_UNAVAILABLE" : "CLIP_GENERATION_FAILED";
    return markClipUnavailable(evidence, reason);
  }
}

function plateRedactionsFromAnprResult(result, privacy = {}) {
  return plateRedactionsFromDetections(result.detections || [], privacy, ["ANPR_PLATE_DETECTION_ACCEPTED"]);
}

function plateRedactionsFromDetections(detections, privacy = {}, extraReasonCodes = []) {
  const enabled = privacy.enabled !== false;
  return detections
    .filter((detection) => detection.quality?.accepted)
    .map((detection) => ({
      targetType: "PLATE",
      action: enabled ? "BLUR" : "DETECT_ONLY",
      method: enabled ? "GAUSSIAN_BLUR" : "NONE",
      bbox: detection.bbox,
      confidence: detection.confidence,
      reasonCodes: enabled
        ? ["PLATE_PRIVACY_REDACTION_ENABLED", ...extraReasonCodes]
        : ["PLATE_DETECTED_REDACTION_DISABLED", ...extraReasonCodes]
    }));
}

function dedupeRedactions(redactions) {
  const seen = new Set();
  const unique = [];
  for (const redaction of redactions) {
    const box = redaction.bbox || {};
    const key = `${redaction.targetType}:${redaction.action}:${box.x}:${box.y}:${box.width}:${box.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(redaction);
  }
  return unique;
}

function analyticsDecisions({ trackEvent, zone, latestTracks }) {
  const analytics = zone.analytics || {};
  const suspicious = analytics.suspicious || {};
  const night = analytics.night || {};
  const tamper = analytics.tamper || {};
  const decisions = [];

  if (suspicious.loitering?.enabled) decisions.push(detectLoitering(trackEvent, zone, withSeverity(suspicious.loitering, zone)));
  if (suspicious.repeatedBoundaryApproach?.enabled) decisions.push(detectRepeatedBoundaryApproach(trackEvent, zone, withSeverity(suspicious.repeatedBoundaryApproach, zone)));
  if (suspicious.suddenSpeedChange?.enabled) decisions.push(detectSuddenSpeedChange(trackEvent, withSeverity(suspicious.suddenSpeedChange, zone)));
  if (suspicious.crowdFormation?.enabled) decisions.push(detectCrowdFormation(latestTracks, zone, withSeverity(suspicious.crowdFormation, zone)));
  if (night.movement?.enabled && trackEvent.frameAnalysis) decisions.push(detectNightMovement(trackEvent, zone, trackEvent.frameAnalysis, withSeverity(night.movement, zone)));
  if (tamper.frameQuality?.enabled && trackEvent.frameAnalysis) decisions.push(detectFrameTamper({ cameraId: trackEvent.cameraId, ...trackEvent.frameAnalysis }, withSeverity(tamper.frameQuality, zone)));

  return decisions.map((decision) => ({
    ruleVersion: analytics.ruleVersion || "analytics.v1",
    ...decision,
    severity: decision.severity || zone.severity || "MEDIUM",
    reasonCodes: [...(decision.reasonCodes || []), `RULE_VERSION_${analytics.ruleVersion || "analytics.v1"}`]
  }));
}

function withSeverity(config, zone) {
  return { ...config, severity: config.severity || zone.severity || "MEDIUM" };
}

async function tryRegisterCamera({ endpoint, camera, backoff }) {
  try {
    const registered = await registerCamera({ endpoint, camera });
    resetBackoff(backoff);
    return registered;
  } catch (error) {
    console.error(`Camera registration unavailable; incidents will queue until command link recovers: ${error.message}`);
    recordBackoffFailure(backoff);
    return { deviceKey: process.env.EDGE_DEVICE_KEY || camera.deviceKey || null, offline: true };
  }
}

async function ensureRegistered({ endpoint, camera, registration, registrationBackoff }) {
  if (registration.value?.deviceKey && registration.value.offline !== true) return registration.value;
  if (!backoffReady(registrationBackoff, "Camera registration")) return null;

  const next = await tryRegisterCamera({ endpoint, camera, backoff: registrationBackoff });
  if (next?.deviceKey) {
    registration.value = next;
    await sendHealth({ endpoint, camera, deviceKey: next.deviceKey }).catch(() => {});
  }
  return registration.value;
}

async function publishIncident({ endpoint, incident, evidence, camera, registration, registrationBackoff, replayBackoff }) {
  const registered = await ensureRegistered({ endpoint, camera, registration, registrationBackoff });
  if (!registered?.deviceKey) {
    enqueueIncident(incident);
    return;
  }

  const accepted = await sendIncident({ endpoint, incident, deviceKey: registered.deviceKey }).catch(() => false);
  if (!accepted) {
    registration.value = { ...registered, offline: true };
    enqueueIncident(incident);
  } else {
    await sendEvidence({ endpoint, evidence, deviceKey: registered.deviceKey, cameraId: incident.cameraId });
    if (!backoffReady(replayBackoff, "Outbox replay")) return;
    const replayed = await replayOutbox({ endpoint, deviceKey: registered.deviceKey }).catch((error) => {
      console.error(`Outbox replay unavailable; retry will back off: ${error.message}`);
      return [{ status: "failed", code: "fetch_error" }];
    });
    if (replayed.some((item) => item.status === "failed")) {
      recordBackoffFailure(replayBackoff);
    } else {
      resetBackoff(replayBackoff);
    }
  }
}

function createBackoffState({ baseMs, maxMs }) {
  return {
    baseMs: Math.max(1, baseMs),
    maxMs: Math.max(1, maxMs),
    failures: 0,
    nextAttemptAt: 0,
    loggedUntil: 0
  };
}

function backoffReady(backoff, label, now = Date.now()) {
  if (!backoff || now >= backoff.nextAttemptAt) return true;
  if (backoff.loggedUntil !== backoff.nextAttemptAt) {
    const waitSeconds = Math.ceil((backoff.nextAttemptAt - now) / 1000);
    console.error(`${label} backing off until ${new Date(backoff.nextAttemptAt).toISOString()}, next attempt in ${waitSeconds}s`);
    backoff.loggedUntil = backoff.nextAttemptAt;
  }
  return false;
}

function recordBackoffFailure(backoff, now = Date.now()) {
  if (!backoff) return;
  backoff.failures += 1;
  const delayMs = Math.min(backoff.maxMs, backoff.baseMs * (2 ** Math.max(0, backoff.failures - 1)));
  backoff.nextAttemptAt = now + delayMs;
  backoff.loggedUntil = 0;
}

function resetBackoff(backoff) {
  if (!backoff) return;
  backoff.failures = 0;
  backoff.nextAttemptAt = 0;
  backoff.loggedUntil = 0;
}

function isCoolingDown(cooldowns, decision, now) {
  const previous = cooldowns.get(decisionKey(decision));
  return previous && now - previous.at < previous.cooldownMs;
}

function rememberCooldown(cooldowns, decision, zone, now) {
  const analytics = zone.analytics || {};
  const cooldownMs = Number(
    decision.metrics?.cooldownMs
    ?? analytics.cooldownMs
    ?? analytics.suspicious?.cooldownMs
    ?? analytics.night?.cooldownMs
    ?? analytics.tamper?.cooldownMs
    ?? 15000
  );
  cooldowns.set(decisionKey(decision), { at: now, cooldownMs });
}

function decisionKey(decision) {
  return `${decision.cameraId || "camera"}:${decision.zoneId || "zone"}:${decision.trackId || decision.trackIds?.join(",") || "frame"}:${decision.type}`;
}

function expireTrackState({ trajectoryHistory, latestTracks, now }) {
  for (const [key, track] of latestTracks.entries()) {
    const captureMs = Date.parse(track.captureTime) || now;
    if (now - captureMs <= TRACK_STATE_TTL_MS) continue;
    latestTracks.delete(key);
    trajectoryHistory.delete(key);
  }
}

function rememberTrackFrame(frameBuffers, trackEvent) {
  if (!trackEvent.frame?.uri?.startsWith("file://")) return;
  const buffer = frameBuffers.get(trackEvent.cameraId) || new RollingFrameBuffer({ cameraId: trackEvent.cameraId });
  buffer.addFrame({
    cameraId: trackEvent.cameraId,
    uri: trackEvent.frame.uri,
    captureTime: trackEvent.captureTime
  });
  frameBuffers.set(trackEvent.cameraId, buffer);
}

function trackKey(trackEvent) {
  return `${trackEvent.cameraId}:${trackEvent.trackId}`;
}

function filePathFromUri(uri) {
  if (!String(uri).startsWith("file://")) throw new Error("ANPR requires a file:// frame URI");
  return decodeURIComponent(String(uri).replace("file://", ""));
}

export function accumulateTrackTrajectory(history, trackEvent, { maxPoints = TRAJECTORY_HISTORY_POINTS } = {}) {
  const key = `${trackEvent.cameraId}:${trackEvent.trackId}`;
  const previous = history.get(key) || [];
  const incoming = normalizeTrajectory(trackEvent);
  const merged = mergeTrajectory(previous, incoming).slice(-maxPoints);
  history.set(key, merged);
  return { ...trackEvent, trajectory: merged };
}

function normalizeTrajectory(trackEvent) {
  const fallbackTime = trackEvent.captureTime || new Date().toISOString();
  return (trackEvent.trajectory || [])
    .filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
    .map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
      t: point.t || fallbackTime
    }));
}

function mergeTrajectory(previous, incoming) {
  const merged = [];
  const seen = new Set();
  for (const point of [...previous, ...incoming]) {
    const key = `${point.x}:${point.y}:${point.t || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(point);
  }
  return merged;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const inputPath = process.argv.find((arg) => arg.startsWith("--input="))?.split("=")[1];
  const input = inputPath ? fs.createReadStream(inputPath) : process.stdin;
  runTrackBridge({ input }).then((incidents) => {
    console.log(JSON.stringify({ incidents: incidents.length }));
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
