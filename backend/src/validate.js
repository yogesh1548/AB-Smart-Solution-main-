'use strict';

const LEVELS = ['Bachelor’s', 'Master’s', 'Other'];
const SERVICES = [
  'Project Report',
  'Thesis Support',
  'Research Proposal',
  'Data Analysis',
  'Academic Editing',
  'CV / Resume',
  'Presentation / Viva',
  'Consultation'
];

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,18}[0-9]$/;

// Control characters, line/paragraph separators, bidi overrides/isolates, zero-width characters, BOM.
const UNSAFE_SINGLE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;
const UNSAFE_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;

function cleanLine(value) {
  return String(value).normalize('NFC').replace(UNSAFE_SINGLE, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return String(value)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(UNSAFE_MULTI, '')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asString(value) {
  return typeof value === 'string' ? value : null;
}

/**
 * @returns {{ok: true, bot: boolean, data?: object} | {ok: false, errors: object}}
 */
function validateContact(body, { minFillTimeMs = 2000 } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { form: 'Invalid request.' } };
  }

  // Honeypot: real people never see or fill this field.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return { ok: true, bot: true };
  }

  const elapsed = body.elapsedMs;
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) {
    return { ok: false, errors: { form: 'Invalid request.' } };
  }
  if (elapsed < minFillTimeMs) {
    return { ok: true, bot: true };
  }

  const errors = {};
  const data = {};

  const rawName = asString(body.name);
  const name = rawName === null ? '' : cleanLine(rawName);
  if (name.length < 2 || name.length > 100) errors.name = 'Please enter your full name (2–100 characters).';
  data.name = name;

  const rawPhone = asString(body.phone);
  const phone = rawPhone === null ? '' : cleanLine(rawPhone);
  const digits = phone.replace(/\D/g, '');
  if (phone.length > 20 || !PHONE_RE.test(phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = 'Please enter a valid phone number.';
  }
  data.phone = phone;

  const rawEmail = body.email === undefined || body.email === null ? '' : asString(body.email);
  const email = rawEmail === null ? null : cleanLine(rawEmail).toLowerCase();
  if (email === null || (email !== '' && (email.length > 254 || !EMAIL_RE.test(email)))) {
    errors.email = 'Please enter a valid email address or leave it blank.';
  }
  data.email = email || '';

  const rawLevel = asString(body.level);
  const level = rawLevel === null ? '' : cleanLine(rawLevel).replace(/'/g, '’');
  if (!LEVELS.includes(level)) errors.level = 'Please choose a valid academic level.';
  data.level = level;

  const rawService = asString(body.service);
  const service = rawService === null ? '' : cleanLine(rawService);
  if (!SERVICES.includes(service)) errors.service = 'Please choose a valid service.';
  data.service = service;

  const rawMessage = asString(body.message);
  const message = rawMessage === null ? '' : cleanText(rawMessage);
  if (message.length < 10 || message.length > 3000) {
    errors.message = 'Please describe your requirement (10–3000 characters).';
  }
  data.message = message;

  if (body.consent !== true) errors.consent = 'Please agree to be contacted about this enquiry.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, bot: false, data };
}

module.exports = { validateContact, cleanLine, cleanText, LEVELS, SERVICES };
