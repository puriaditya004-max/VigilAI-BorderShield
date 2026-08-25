export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-device-key,idempotency-key"
  });
  res.end(JSON.stringify(payload, null, 2));
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
