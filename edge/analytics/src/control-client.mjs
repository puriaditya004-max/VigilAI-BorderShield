export async function registerCamera({ endpoint, camera }) {
  const response = await fetch(`${endpoint}/api/cameras/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `register-${camera.cameraId}` },
    body: JSON.stringify(camera)
  });
  if (!response.ok) throw new Error(`camera registration failed: ${response.status}`);
  return response.json();
}

export async function sendHealth({ endpoint, camera, deviceKey }) {
  const now = new Date().toISOString();
  const response = await fetch(`${endpoint}/api/cameras/health`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey,
      "idempotency-key": `health-${camera.cameraId}-${Date.now()}`
    },
    body: JSON.stringify({
      schemaVersion: "camera-health.v1",
      eventId: `evt-camera-health-${Date.now()}`,
      cameraId: camera.cameraId,
      edgeNodeId: camera.edgeNodeId,
      status: "ONLINE",
      captureTime: now,
      ingestTime: now,
      stream: { uri: camera.streamUri, codec: "H264", fps: 25 },
      quality: { blurScore: 0.1, darknessScore: 0.2, droppedFrames: 0 }
    })
  });
  if (!response.ok) throw new Error(`camera health failed: ${response.status}`);
}

export async function sendIncident({ endpoint, incident, deviceKey }) {
  const response = await fetch(`${endpoint}/api/incidents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey,
      "idempotency-key": incident.eventId
    },
    body: JSON.stringify(incident)
  });
  return response.ok;
}

export async function sendEvidence({ endpoint, evidence, deviceKey, cameraId }) {
  const response = await fetch(`${endpoint}/api/evidence/manifests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey,
      "x-camera-id": cameraId,
      "idempotency-key": evidence.manifestId
    },
    body: JSON.stringify({
      schemaVersion: evidence.schemaVersion,
      manifestId: evidence.manifestId,
      incidentId: evidence.incidentId,
      createdAt: evidence.createdAt,
      assets: evidence.assets,
      sha256: evidence.sha256,
      metadata: evidence.metadata
    })
  });
  if (!response.ok) throw new Error(`evidence manifest failed: ${response.status}`);
}
