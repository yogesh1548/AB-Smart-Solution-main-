'use strict';

const http = require('node:http');
const { loadConfig } = require('../src/config');
const { RateLimiter } = require('../src/rateLimit');
const { createHandler } = require('../src/app');

const ORIGIN = 'https://absmartsolution.com.np';

function makeConfig(overrides = {}) {
  return loadConfig({
    ALLOWED_ORIGINS: `${ORIGIN},https://www.absmartsolution.com.np`,
    GMAIL_USER: 'absmartsolution2026@gmail.com',
    GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
    MAIL_MODE: 'smtp',
    ...overrides
  });
}

async function startServer({ env = {}, mailer } = {}) {
  const config = makeConfig(env);
  const sent = [];
  const fakeMailer = mailer || {
    mode: 'fake',
    async send(message) {
      sent.push(message);
    }
  };
  const silent = { error() {}, warn() {}, log() {} };
  const handler = createHandler({
    config,
    mailer: fakeMailer,
    ipLimiter: new RateLimiter(config.ipRules),
    globalLimiter: new RateLimiter(config.globalRules),
    logger: silent
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, port, sent, config, close: () => new Promise((r) => server.close(r)) };
}

function request(port, { method = 'POST', path = '/api/contact', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function validBody(overrides = {}) {
  return {
    name: 'Sita Sharma',
    phone: '+977 9812345678',
    email: 'Sita@Example.com',
    level: 'Master’s',
    service: 'Thesis Support',
    message: 'I need help with my thesis methodology chapter by next month.',
    consent: true,
    website: '',
    elapsedMs: 15000,
    ...overrides
  };
}

const jsonHeaders = (extra = {}) => ({ 'Content-Type': 'application/json', Origin: ORIGIN, ...extra });

module.exports = { ORIGIN, makeConfig, startServer, request, validBody, jsonHeaders };
