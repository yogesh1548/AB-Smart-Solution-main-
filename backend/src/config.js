'use strict';

const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOrigin(value, errors) {
  const trimmed = value.replace(/\/+$/, '');
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    errors.push(`ALLOWED_ORIGINS contains an invalid origin: "${value}"`);
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    errors.push(`ALLOWED_ORIGINS must use http or https: "${value}"`);
    return null;
  }
  if (url.origin.toLowerCase() !== trimmed.toLowerCase()) {
    errors.push(`ALLOWED_ORIGINS must be a bare origin without a path: "${value}"`);
    return null;
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'http:' && !isLocal) {
    errors.push(`ALLOWED_ORIGINS must use https for non-local sites: "${value}"`);
    return null;
  }
  return url.origin.toLowerCase();
}

function parseIntInRange(raw, fallback, min, max, name, errors) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${name} must be a whole number between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

function loadConfig(env = process.env) {
  const errors = [];

  const mode = String(env.MAIL_MODE || 'smtp').trim().toLowerCase();
  if (mode !== 'smtp' && mode !== 'gmail-api') {
    errors.push('MAIL_MODE must be "smtp" or "gmail-api"');
  }

  const gmailUser = String(env.GMAIL_USER || '').trim();
  if (!EMAIL_RE.test(gmailUser)) errors.push('GMAIL_USER is missing or not a valid email address');

  const mailToList = parseList(env.MAIL_TO);
  const mailTo = mailToList.length ? mailToList : gmailUser ? [gmailUser] : [];
  for (const address of mailTo) {
    if (!EMAIL_RE.test(address)) errors.push(`MAIL_TO contains an invalid address: "${address}"`);
  }

  const gmailAppPassword = String(env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const google = {
    clientId: String(env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(env.GOOGLE_CLIENT_SECRET || '').trim(),
    refreshToken: String(env.GOOGLE_REFRESH_TOKEN || '').trim()
  };

  if (mode === 'smtp' && !gmailAppPassword) {
    errors.push('GMAIL_APP_PASSWORD is required when MAIL_MODE=smtp');
  }
  if (mode === 'gmail-api') {
    if (!google.clientId) errors.push('GOOGLE_CLIENT_ID is required when MAIL_MODE=gmail-api');
    if (!google.clientSecret) errors.push('GOOGLE_CLIENT_SECRET is required when MAIL_MODE=gmail-api');
    if (!google.refreshToken) errors.push('GOOGLE_REFRESH_TOKEN is required when MAIL_MODE=gmail-api');
  }

  const originList = parseList(env.ALLOWED_ORIGINS);
  if (!originList.length) errors.push('ALLOWED_ORIGINS is required');
  const allowedOrigins = originList.map((o) => parseOrigin(o, errors)).filter(Boolean);

  const port = parseIntInRange(env.PORT, 3000, 1, 65535, 'PORT', errors);
  const trustProxy = parseIntInRange(env.TRUST_PROXY, 0, 0, 5, 'TRUST_PROXY', errors);

  if (errors.length) {
    const error = new Error('Invalid configuration:\n - ' + errors.join('\n - '));
    error.code = 'INVALID_CONFIG';
    throw error;
  }

  return Object.freeze({
    mode,
    gmailUser,
    gmailAppPassword,
    google,
    mailTo,
    allowedOrigins,
    port,
    trustProxy,
    maxBodyBytes: 10 * 1024,
    minFillTimeMs: 2000,
    ipRules: [
      { name: 'burst', windowMs: 10 * 60 * 1000, max: 5 },
      { name: 'daily', windowMs: 24 * 60 * 60 * 1000, max: 20 }
    ],
    globalRules: [{ name: 'global-daily', windowMs: 24 * 60 * 60 * 1000, max: 150 }]
  });
}

module.exports = { loadConfig };
