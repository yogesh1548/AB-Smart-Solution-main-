'use strict';

const { HttpError, applySecurityHeaders, sendJson, readJsonBody, clientIp } = require('./http');
const { validateContact } = require('./validate');
const { buildEmail } = require('./mail');

const MAIL_FAILURE_MESSAGE =
  'We could not send your message right now. Please contact us on WhatsApp or by phone.';

function createHandler({ config, mailer, ipLimiter, globalLimiter, logger = console }) {
  async function route(req, res) {
    applySecurityHeaders(res);

    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      throw new HttpError(400, 'Bad request');
    }

    if (pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname !== '/api/contact') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    // ---- CORS / origin allow-list (the browser always sends Origin on cross-origin requests) ----
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.toLowerCase() : '';
    if (!origin || !config.allowedOrigins.includes(origin)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600'
      });
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST, OPTIONS' });
      return;
    }

    // ---- Per-IP rate limit (counts every POST, valid or not) ----
    const ip = clientIp(req, config.trustProxy);
    const ipCheck = ipLimiter.consume(ip);
    if (!ipCheck.allowed) {
      sendJson(
        res,
        429,
        { error: 'Too many requests. Please try again later.' },
        { 'Retry-After': String(ipCheck.retryAfterSec) }
      );
      return;
    }

    const body = await readJsonBody(req, config.maxBodyBytes);
    const result = validateContact(body, { minFillTimeMs: config.minFillTimeMs });

    if (!result.ok) {
      sendJson(res, 400, { error: 'Please check the form and try again.', fields: result.errors });
      return;
    }

    // Bots get a normal-looking success so they learn nothing, but nothing is sent.
    if (result.bot) {
      sendJson(res, 200, { ok: true });
      return;
    }

    // ---- Global daily cap protects the Gmail sending quota ----
    const globalCheck = globalLimiter.consume('*');
    if (!globalCheck.allowed) {
      logger.warn('global_send_limit_reached');
      sendJson(res, 503, { error: MAIL_FAILURE_MESSAGE }, { 'Retry-After': String(globalCheck.retryAfterSec) });
      return;
    }

    try {
      await mailer.send(buildEmail(result.data, { ip, receivedAt: new Date() }, config));
    } catch (error) {
      // Never log message contents or credentials - only a short, safe error summary.
      logger.error('mail_send_failed', error && (error.code || error.responseCode || error.message));
      sendJson(res, 502, { error: MAIL_FAILURE_MESSAGE });
      return;
    }

    sendJson(res, 200, { ok: true });
  }

  return async function handler(req, res) {
    try {
      await route(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) {
        const headers = error.status === 413 ? { Connection: 'close' } : {};
        sendJson(res, error.status, { error: error.message }, headers);
        return;
      }
      logger.error('unhandled_error', error && error.message);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  };
}

module.exports = { createHandler };
