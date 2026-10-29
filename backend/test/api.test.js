'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ORIGIN, startServer, request, validBody, jsonHeaders } = require('./helpers');

test('health check and unknown routes', async () => {
  const s = await startServer();
  try {
    const ok = await request(s.port, { method: 'GET', path: '/health' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { status: 'ok' });
    assert.equal((await request(s.port, { method: 'GET', path: '/' })).status, 404);
    assert.equal((await request(s.port, { method: 'GET', path: '/api/other' })).status, 404);
  } finally {
    await s.close();
  }
});

test('security headers are present', async () => {
  const s = await startServer();
  try {
    const r = await request(s.port, { method: 'GET', path: '/health' });
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(r.headers['strict-transport-security']);
    assert.equal(r.headers['x-powered-by'], undefined);
  } finally {
    await s.close();
  }
});

test('CORS: preflight allowed only for allow-listed origins', async () => {
  const s = await startServer();
  try {
    const good = await request(s.port, { method: 'OPTIONS', headers: { Origin: ORIGIN } });
    assert.equal(good.status, 204);
    assert.equal(good.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(good.headers.vary, 'Origin');
    assert.match(good.headers['access-control-allow-methods'], /POST/);

    const bad = await request(s.port, { method: 'OPTIONS', headers: { Origin: 'https://evil.com' } });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers['access-control-allow-origin'], undefined);
  } finally {
    await s.close();
  }
});

test('POST without or with wrong Origin is forbidden and sends nothing', async () => {
  const s = await startServer();
  try {
    const noOrigin = await request(s.port, { headers: { 'Content-Type': 'application/json' }, body: validBody() });
    assert.equal(noOrigin.status, 403);
    const wrong = await request(s.port, { headers: jsonHeaders({ Origin: 'https://evil.com' }), body: validBody() });
    assert.equal(wrong.status, 403);
    assert.equal(s.sent.length, 0);
  } finally {
    await s.close();
  }
});

test('method, content-type, JSON and size checks', async () => {
  const s = await startServer();
  try {
    assert.equal((await request(s.port, { method: 'GET', headers: { Origin: ORIGIN } })).status, 405);
    assert.equal((await request(s.port, { headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: 'hi' })).status, 415);
    assert.equal((await request(s.port, { headers: jsonHeaders(), body: '{bad json' })).status, 400);
    assert.equal((await request(s.port, { headers: jsonHeaders(), body: '[1,2]' })).status, 400);
    const big = await request(s.port, { headers: jsonHeaders(), body: JSON.stringify({ message: 'x'.repeat(20000) }) });
    assert.equal(big.status, 413);
    assert.equal(s.sent.length, 0);
  } finally {
    await s.close();
  }
});

test('validation errors return 400 with field messages', async () => {
  const s = await startServer();
  try {
    const r = await request(s.port, { headers: jsonHeaders(), body: validBody({ name: '', phone: '1' }) });
    assert.equal(r.status, 400);
    assert.ok(r.json.fields.name);
    assert.ok(r.json.fields.phone);
    assert.equal(s.sent.length, 0);
  } finally {
    await s.close();
  }
});

test('valid submission is emailed once and returns ok', async () => {
  const s = await startServer();
  try {
    const r = await request(s.port, { headers: jsonHeaders(), body: validBody() });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].to, 'absmartsolution2026@gmail.com');
    assert.equal(s.sent[0].replyTo.address, 'sita@example.com');
    assert.match(s.sent[0].subject, /Thesis Support - Sita Sharma/);
    assert.match(s.sent[0].text, /thesis methodology/);
  } finally {
    await s.close();
  }
});

test('bots (honeypot / too fast) get a fake success but nothing is sent', async () => {
  const s = await startServer();
  try {
    const a = await request(s.port, { headers: jsonHeaders(), body: validBody({ website: 'http://spam.example' }) });
    const b = await request(s.port, { headers: jsonHeaders(), body: validBody({ elapsedMs: 100 }) });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(s.sent.length, 0);
  } finally {
    await s.close();
  }
});

test('mail failure returns 502 without leaking details', async () => {
  const mailer = {
    mode: 'fake',
    async send() {
      const e = new Error('Invalid login: password abcd1234 rejected');
      e.code = 'EAUTH';
      throw e;
    }
  };
  const s = await startServer({ mailer });
  try {
    const r = await request(s.port, { headers: jsonHeaders(), body: validBody() });
    assert.equal(r.status, 502);
    assert.ok(!r.text.includes('abcd1234'));
    assert.ok(!r.text.includes('EAUTH'));
  } finally {
    await s.close();
  }
});

test('per-IP rate limit returns 429 with Retry-After after 5 requests', async () => {
  const s = await startServer();
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await request(s.port, { headers: jsonHeaders(), body: validBody() })).status, 200);
    }
    const blocked = await request(s.port, { headers: jsonHeaders(), body: validBody() });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(s.sent.length, 5);
  } finally {
    await s.close();
  }
});

test('spoofed X-Forwarded-For cannot dodge the limit when TRUST_PROXY=1', async () => {
  const s = await startServer({ env: { TRUST_PROXY: '1' } });
  try {
    for (let i = 0; i < 5; i += 1) {
      const r = await request(s.port, { headers: jsonHeaders({ 'X-Forwarded-For': `9.9.9.${i}, 203.0.113.7` }), body: validBody() });
      assert.equal(r.status, 200);
    }
    const blocked = await request(s.port, { headers: jsonHeaders({ 'X-Forwarded-For': '1.2.3.4, 203.0.113.7' }), body: validBody() });
    assert.equal(blocked.status, 429);
    const other = await request(s.port, { headers: jsonHeaders({ 'X-Forwarded-For': '1.2.3.4, 203.0.113.8' }), body: validBody() });
    assert.equal(other.status, 200);
  } finally {
    await s.close();
  }
});
