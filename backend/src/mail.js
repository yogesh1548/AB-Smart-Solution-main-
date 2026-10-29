'use strict';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SITE_NAME = 'AB Smart Solution';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNepalTime(date) {
  try {
    return (
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kathmandu',
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date) + ' (Nepal time)'
    );
  } catch {
    return date.toISOString();
  }
}

/** Builds the notification email. Inputs are already validated and cleaned. */
function buildEmail(data, meta, config) {
  const when = formatNepalTime(meta.receivedAt || new Date());
  const subject = `Website enquiry: ${data.service} - ${data.name}`.slice(0, 150);

  const text = [
    `New enquiry from the ${SITE_NAME} website`,
    '',
    `Name: ${data.name}`,
    `Phone: ${data.phone}`,
    `Email: ${data.email || '(not provided)'}`,
    `Academic level: ${data.level}`,
    `Service required: ${data.service}`,
    '',
    'Requirement:',
    data.message,
    '',
    `Received: ${when}`,
    `IP address: ${meta.ip}`
  ].join('\n');

  const row = (label, value) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>` +
    `<td style="padding:6px 0;color:#0f172a">${value}</td></tr>`;

  const phoneHtml = `<a href="tel:${escapeHtml(data.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(data.phone)}</a>`;
  const emailHtml = data.email
    ? `<a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a>`
    : '<em>not provided</em>';

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;max-width:640px">` +
    `<h2 style="margin:0 0 12px;color:#0b1f3a">New website enquiry</h2>` +
    `<table style="border-collapse:collapse">` +
    row('Name', escapeHtml(data.name)) +
    row('Phone', phoneHtml) +
    row('Email', emailHtml) +
    row('Academic level', escapeHtml(data.level)) +
    row('Service', escapeHtml(data.service)) +
    `</table>` +
    `<p style="margin:16px 0 6px;color:#64748b">Requirement</p>` +
    `<div style="white-space:pre-wrap;border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc">${escapeHtml(data.message)}</div>` +
    `<p style="margin:16px 0 0;color:#64748b;font-size:12px">Received ${escapeHtml(when)} · IP ${escapeHtml(meta.ip)}</p>` +
    `</div>`;

  const message = {
    from: { name: `${SITE_NAME} Website`, address: config.gmailUser },
    to: config.mailTo.join(', '),
    subject,
    text,
    html
  };
  if (data.email) message.replyTo = { name: data.name, address: data.email };
  return message;
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Gmail over SMTP using an App Password. Needs outbound port 465 (blocked on some free hosts). */
function createSmtpMailer(config, transporterOverride) {
  let transporter = transporterOverride;
  const getTransporter = () => {
    if (!transporter) {
      const nodemailer = require('nodemailer');
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: config.gmailUser, pass: config.gmailAppPassword },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000
      });
    }
    return transporter;
  };

  return {
    mode: 'smtp',
    async send(message) {
      await getTransporter().sendMail(message);
    },
    async verify() {
      await getTransporter().verify();
    }
  };
}

function buildRawMessage(message) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  return new Promise((resolve, reject) => {
    new MailComposer({ ...message, date: new Date() }).compile().build((error, buffer) => {
      if (error) reject(error);
      else resolve(buffer.toString('base64url'));
    });
  });
}

/** Gmail over HTTPS (OAuth2 refresh token). Works on hosts that block SMTP ports. */
function createGmailApiMailer(config, { fetchImpl = globalThis.fetch, buildRaw = buildRawMessage } = {}) {
  let cached = { token: null, expiresAt: 0 };

  async function getAccessToken() {
    if (cached.token && Date.now() < cached.expiresAt - 60000) return cached.token;

    const response = await fetchWithTimeout(fetchImpl, GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: config.google.refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
    if (!response.ok) throw new Error(`Google token refresh failed (HTTP ${response.status})`);

    const json = await response.json();
    if (!json || typeof json.access_token !== 'string') throw new Error('Google token response was invalid');
    cached = {
      token: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000
    };
    return cached.token;
  }

  return {
    mode: 'gmail-api',
    async send(message) {
      const raw = await buildRaw(message);
      const token = await getAccessToken();
      const response = await fetchWithTimeout(fetchImpl, GMAIL_SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
      });
      if (response.status === 401) cached = { token: null, expiresAt: 0 };
      if (!response.ok) throw new Error(`Gmail API send failed (HTTP ${response.status})`);
    },
    async verify() {
      await getAccessToken();
    }
  };
}

function createMailer(config) {
  return config.mode === 'gmail-api' ? createGmailApiMailer(config) : createSmtpMailer(config);
}

module.exports = {
  buildEmail,
  escapeHtml,
  createMailer,
  createSmtpMailer,
  createGmailApiMailer
};
