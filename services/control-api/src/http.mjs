const DEFAULT_MAX_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 1024 * 1024);

export async function readJsonBody(req, { maxBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = new Error("request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

export function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, withSecurityHeaders({
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-device-key,idempotency-key,x-camera-id,x-operator-id,x-operator-role,authorization",
    ...extraHeaders
  }));
  res.end(JSON.stringify(payload, null, 2));
}

export function withSecurityHeaders(headers = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    ...headers
  };
}

export function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

export function badRequest(res, message, details = []) {
  sendJson(res, 400, { error: "bad_request", message, details });
}

export function unauthorized(res, message = "invalid device credentials") {
  sendJson(res, 401, { error: "unauthorized", message });
}

export function forbidden(res, message = "forbidden") {
  sendJson(res, 403, { error: "forbidden", message });
}

export function payloadTooLarge(res, message = "request body too large") {
  sendJson(res, 413, { error: "payload_too_large", message });
}
