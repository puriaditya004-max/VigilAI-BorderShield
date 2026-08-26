const SOURCE_TYPES = new Set(["USB", "VIDEO_FILE", "RTSP", "ONVIF"]);

export function normalizeCameraSource(config) {
  const source = {
    cameraId: requiredString(config.cameraId, "cameraId"),
    name: requiredString(config.name, "name"),
    edgeNodeId: requiredString(config.edgeNodeId, "edgeNodeId"),
    location: config.location || "unknown",
    sourceType: config.sourceType || inferSourceType(config.streamUri ?? config.source),
    streamUri: requiredString(config.streamUri ?? config.source, "streamUri"),
    frameSampling: {
      targetFps: Number(config.frameSampling?.targetFps ?? 8),
      maxDecodeFps: Number(config.frameSampling?.maxDecodeFps ?? 25)
    },
    runtime: {
      mode: config.runtime?.mode || "CPU",
      tracker: config.runtime?.tracker || "bytetrack"
    },
    reconnect: {
      initialDelayMs: Number(config.reconnect?.initialDelayMs ?? 500),
      maxDelayMs: Number(config.reconnect?.maxDelayMs ?? 30000),
      multiplier: Number(config.reconnect?.multiplier ?? 2)
    }
  };

  if (!SOURCE_TYPES.has(source.sourceType)) {
    throw new Error(`unsupported sourceType: ${source.sourceType}`);
  }
  if (source.frameSampling.targetFps <= 0 || source.frameSampling.maxDecodeFps <= 0) {
    throw new Error("frame sampling FPS values must be positive");
  }
  if (source.frameSampling.targetFps > source.frameSampling.maxDecodeFps) {
    throw new Error("targetFps cannot exceed maxDecodeFps");
  }

  return source;
}

export function inferSourceType(value) {
  const source = String(value || "");
  if (/^\d+$/.test(source)) return "USB";
  if (/^rtsp:\/\//i.test(source)) return "RTSP";
  if (/^onvif:\/\//i.test(source)) return "ONVIF";
  return "VIDEO_FILE";
}

export function redactUri(uri) {
  return String(uri).replace(/\/\/([^:/?#]+):([^@/?#]+)@/g, "//***:***@");
}

export function reconnectDelay(attempt, policy) {
  const initial = Number(policy.initialDelayMs);
  const max = Number(policy.maxDelayMs);
  const multiplier = Number(policy.multiplier);
  return Math.min(max, Math.round(initial * multiplier ** Math.max(0, attempt - 1)));
}

export class StreamHealthTracker {
  constructor({ cameraId, edgeNodeId, streamUri }) {
    this.cameraId = cameraId;
    this.edgeNodeId = edgeNodeId;
    this.streamUri = streamUri;
    this.status = "OFFLINE";
    this.frames = 0;
    this.droppedFrames = 0;
    this.connectedAt = null;
    this.lastFrameAt = null;
    this.lastDisconnectAt = null;
    this.latencySamples = [];
  }

  connect(now = new Date()) {
    this.status = "ONLINE";
    this.connectedAt = now.toISOString();
  }

  observeFrame({ captureTime = new Date(), ingestTime = new Date() } = {}) {
    this.status = "ONLINE";
    this.frames += 1;
    this.lastFrameAt = ingestTime.toISOString();
    this.latencySamples.push(Math.max(0, ingestTime.getTime() - captureTime.getTime()));
    this.latencySamples = this.latencySamples.slice(-50);
  }

  observeDroppedFrame() {
    this.droppedFrames += 1;
    if (this.droppedFrames > 5) this.status = "DEGRADED";
  }

  disconnect(now = new Date()) {
    this.status = "OFFLINE";
    this.lastDisconnectAt = now.toISOString();
  }

  snapshot(now = new Date()) {
    const averageLatencyMs = this.latencySamples.length
      ? Math.round(this.latencySamples.reduce((sum, value) => sum + value, 0) / this.latencySamples.length)
      : 0;

    return {
      schemaVersion: "camera-health.v1",
      eventId: `evt-camera-health-${this.cameraId}-${now.getTime()}`,
      cameraId: this.cameraId,
      edgeNodeId: this.edgeNodeId,
      status: this.status,
      captureTime: this.lastFrameAt && this.status !== "OFFLINE" ? this.lastFrameAt : now.toISOString(),
      ingestTime: now.toISOString(),
      stream: {
        uri: redactUri(this.streamUri),
        codec: "UNKNOWN",
        fps: this.frames
      },
      quality: {
        blurScore: 0,
        darknessScore: 0,
        droppedFrames: this.droppedFrames,
        averageLatencyMs
      }
    };
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value;
}
