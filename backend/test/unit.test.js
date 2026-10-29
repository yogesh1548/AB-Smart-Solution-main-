'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { RateLimiter } = require('../src/rateLimit');
const { validateContact } = require('../src/validate');
const { buildEmail, createSmtpMailer, createGmailApiMailer } = require('../src/mail');
const { clientIp } = require('../src/http');
const { makeConfig, validBody } = require('./helpers');

test('config: rejects missing / insecure settings', () => {
  assert.throws(() => loadConfig({}), /GMAIL_USER/);
  assert.throws(
    () => loadConfig({ GMAIL_USER: 'a@b.com', GMAIL_APP_PASSWORD: 'x', ALLOWED_ORIGINS: 'http://evil.com' }),
    /https/
  );
  assert.throws(
    () => loadConfig({ GMAIL_USER: 'a@b.com', GMAIL_APP_PASSWORD: 'x', ALLOWED_ORIGINS: 'https://a.com/path' }),
    /path/
  );
  assert.throws(
    () => loadConfig({ GMAIL_USER: 'a@b.com', ALLOWED_ORIGINS: 'https://a.com' }),
    /GMAIL_APP_PASSWORD/
  );
  assert.throws(
    () => loadConfig({ GMAIL_USER: 'a@b.com', MAIL_MODE: 'gmail-api', ALLOWED_ORIGINS: 'https://a.com' }),
    /GOOGLE_CLIENT_ID/
  );
});

test('config: normalises values', () => {
  const c = makeConfig({ ALLOWED_ORIGINS: 'https://AbSmartSolution.com.np/ , http://localhost:5500' });
  assert.deepEqual(c.allowedOrigins, ['https://absmartsolution.com.np', 'http://localhost:5500']);
  assert.equal(c.gmailAppPassword, 'abcdefghijklmnop');
  assert.deepEqual(c.mailTo, ['absmartsolution2026@gmail.com']);
  assert.throws(() => makeConfig({ PORT: '99999' }), /PORT/);
});

test('rate limiter: blocks after max, reports retry, does not record denied hits', () => {
  const rl = new RateLimiter([{ name: 'r', windowMs: 1000, max: 2 }]);
  assert.equal(rl.consume('a', 0).allowed, true);
  assert.equal(rl.consume('a', 100).allowed, true);
  const denied = rl.consume('a', 200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSec, 1);
  assert.equal(rl.consume('b', 200).allowed, true);
  assert.equal(rl.consume('a', 1001).allowed, true);
  assert.equal(rl.consume('a', 1002).allowed, false);
  rl.sweep(10000);
  assert.equal(rl.hits.size, 0);
});

test('validate: accepts a good submission and normalises it', () => {
  const r = validateContact(validBody({ level: "Master's" }));
  assert.equal(r.ok, true);
  assert.equal(r.bot, false);
  assert.equal(r.data.email, 'sita@example.com');
  assert.equal(r.data.level, 'Master’s');
});

test('validate: honeypot and too-fast submissions are flagged as bots', () => {
  assert.equal(validateContact(validBody({ website: 'http://spam' })).bot, true);
  assert.equal(validateContact(validBody({ elapsedMs: 500 })).bot, true);
});

test('validate: missing timing field is an invalid request', () => {
  const body = validBody();
  delete body.elapsedMs;
  const r = validateContact(body);
  assert.equal(r.ok, false);
  assert.ok(r.errors.form);
});

test('validate: rejects bad fields with per-field messages', () => {
  const r = validateContact(
    validBody({ name: 'A', phone: 'abc', email: 'not-an-email', level: 'PhD', service: 'Hacking', message: 'short', consent: 'yes' })
  );
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['consent', 'email', 'level', 'message', 'name', 'phone', 'service']);
});

test('validate: wrong types never throw', () => {
  for (const bad of [null, [], 'x', 5, { name: {}, phone: [], email: 7, message: null, elapsedMs: 9999 }]) {
    assert.doesNotThrow(() => validateContact(bad));
    assert.notEqual(validateContact(bad).ok && !validateContact(bad).bot, true);
  }
});

test('validate: strips header-injection and control characters', () => {
  const r = validateContact(
    validBody({ name: 'Ram\r\nBcc: evil@x.com', message: 'Hello\u202Eevil\u0000 text here\r\n\r\n\r\n\r\nend' })
  );
  assert.equal(r.ok, true);
  assert.equal(/[\r\n]/.test(r.data.name), false);
  assert.equal(r.data.name, 'Ram Bcc: evil@x.com');
  assert.equal(/[\u202E\u0000]/.test(r.data.message), false);
  assert.equal(/\n{3,}/.test(r.data.message), false);
});

test('email: builds safe subject, escapes HTML, sets reply-to', () => {
  const config = makeConfig();
  const v = validateContact(validBody({ name: '<b>Ram</b>', message: '<script>alert(1)</script> please help me' }));
  const mail = buildEmail(v.data, { ip: '1.2.3.4' }, config);
  assert.equal(mail.to, 'absmartsolution2026@gmail.com');
  assert.equal(mail.from.address, 'absmartsolution2026@gmail.com');
  assert.equal(mail.replyTo.address, 'sita@example.com');
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(!/[\r\n]/.test(mail.subject));
});

test('email: no reply-to when visitor gave no email', () => {
  const v = validateContact(validBody({ email: '' }));
  const mail = buildEmail(v.data, { ip: '1.2.3.4' }, makeConfig());
  assert.equal(mail.replyTo, undefined);
});

test('client ip: only trusts the proxy-added (right-most) entry', () => {
  const req = (xff, remote = '10.0.0.1') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('6.6.6.6, 203.0.113.9'), 1), '203.0.113.9');
  assert.equal(clientIp(req('203.0.113.9'), 0), '10.0.0.1');
  assert.equal(clientIp(req(undefined, '::ffff:1.1.1.1'), 1), '1.1.1.1');
  assert.equal(clientIp(req('203.0.113.9'), 3), '10.0.0.1');
});

test('smtp mailer: delegates to transporter', async () => {
  const calls = [];
  const mailer = createSmtpMailer(makeConfig(), { sendMail: async (m) => calls.push(m), verify: async () => true });
  await mailer.send({ subject: 's' });
  await mailer.verify();
  assert.equal(calls.length, 1);
});

test('gmail api mailer: refreshes token, sends raw message, caches token', async () => {
  const config = makeConfig({
    MAIL_MODE: 'gmail-api',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'refresh'
  });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const mailer = createGmailApiMailer(config, { fetchImpl, buildRaw: async () => 'RAWDATA' });
  await mailer.send({ subject: 'x' });
  await mailer.send({ subject: 'y' });
  const tokenCalls = calls.filter((c) => c.url.includes('oauth2'));
  const sendCalls = calls.filter((c) => c.url.includes('gmail.googleapis'));
  assert.equal(tokenCalls.length, 1);
  assert.equal(sendCalls.length, 2);
  assert.equal(sendCalls[0].options.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(sendCalls[0].options.body), { raw: 'RAWDATA' });
  assert.ok(tokenCalls[0].options.body.includes('grant_type=refresh_token'));
});

test('gmail api mailer: surfaces failures without leaking secrets', async () => {
  const config = makeConfig({ MAIL_MODE: 'gmail-api', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'SECRET-VALUE-456', GOOGLE_REFRESH_TOKEN: 'RT-VALUE-123' });
  const mailer = createGmailApiMailer(config, {
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }),
    buildRaw: async () => 'RAW'
  });
  await assert.rejects(() => mailer.send({}), (e) => /HTTP 400/.test(e.message) && !/SECRET-VALUE-456|RT-VALUE-123/.test(e.message));
});
