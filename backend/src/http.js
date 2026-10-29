'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store'
};

function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  res.removeHeader('X-Powered-By');
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (!type.startsWith('application/json')) {
      reject(new HttpError(415, 'Content-Type must be application/json'));
      return;
    }

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, 'Request body too large'));
      return;
    }

    let size = 0;
    let finished = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > maxBytes) {
        finished = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (finished) return;
      finished = true;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(new HttpError(400, 'JSON body must be an object'));
        return;
      }
      resolve(parsed);
    });

    req.on('error', () => {
      if (finished) return;
      finished = true;
      reject(new HttpError(400, 'Request error'));
    });
  });
}

function normalizeIp(value) {
  return String(value || 'unknown').replace(/^::ffff:/i, '').slice(0, 64);
}

/**
 * Client IP. With trustProxy = N we trust the N-th entry from the RIGHT of
 * X-Forwarded-For (the one added by our own proxy); anything to its left can be forged.
 */
function clientIp(req, trustProxy) {
  if (trustProxy > 0) {
    const header = req.headers['x-forwarded-for'];
    if (typeof header === 'string') {
      const parts = header.split(',').map((part) => part.trim()).filter(Boolean);
      const candidate = parts[parts.length - trustProxy];
      if (candidate) return normalizeIp(candidate);
    }
  }
  return normalizeIp(req.socket && req.socket.remoteAddress);
}

module.exports = { HttpError, applySecurityHeaders, sendJson, readJsonBody, clientIp };
