import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';

describe('failure cases', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('returns 413 when JSON body exceeds the 4 MB limit', async () => {
    const huge = { data: 'x'.repeat(5 * 1024 * 1024) };
    const res = await request(app)
      .post('/https://example.com/')
      .set('Content-Type', 'application/json')
      .send(huge)
      .expect(413);

    assert.equal(res.body.status, 'error');
  });

  it('returns 413 when urlencoded body exceeds the 4 MB limit', async () => {
    const huge = { data: 'x'.repeat(5 * 1024 * 1024) };
    const res = await request(app)
      .post('/https://example.com/')
      .type('form')
      .send(huge)
      .expect(413);

    assert.equal(res.body.status, 'error');
  });

  it('returns 400 for a malformed target URL', async () => {
    const res = await request(app)
      .get('/not-a-valid-url')
      .expect(400);

    assert.equal(res.body.status, 'error');
  });

  it('returns 400 for unsupported protocols', async () => {
    for (const target of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com']) {
      const res = await request(app).get(`/${target}`).expect(400);
      assert.equal(res.body.status, 'error');
    }
  });

  it('returns 400 when the target host cannot be resolved', async () => {
    const res = await request(app)
      .get('/https://this-domain-does-not-exist-12345.invalid/')
      .expect(400);

    assert.equal(res.body.status, 'error');
  });

  it('returns 504 when the upstream request times out', async () => {
    nock('https://example.com')
      .get('/slow')
      .delayConnection(2000)
      .reply(200, { ok: true });

    const res = await request(app)
      .get('/https://example.com/slow')
      .expect(504);

    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, 'Upstream request timed out');
  });

  it('returns 502 for a generic upstream failure', async () => {
    nock('https://example.com')
      .get('/broken')
      .replyWithError(new Error('socket hang up'));

    const res = await request(app)
      .get('/https://example.com/broken')
      .expect(502);

    assert.equal(res.body.status, 'error');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const previousLimit = process.env.RATE_LIMIT_PER_MINUTE;
    process.env.RATE_LIMIT_PER_MINUTE = '1';

    try {
      nock('https://example.com').get('/limited').reply(200, { ok: true });

      // Use a unique forwarded IP so earlier tests do not affect this bucket.
      const uniqueIP = '203.0.113.42';
      await request(app)
        .get('/https://example.com/limited')
        .set('x-forwarded-for', uniqueIP)
        .expect(200);

      const res = await request(app)
        .get('/https://example.com/limited')
        .set('x-forwarded-for', uniqueIP)
        .expect(429);
      assert.equal(res.body.status, 'error');
      assert.ok(res.headers['retry-after']);
    } finally {
      process.env.RATE_LIMIT_PER_MINUTE = previousLimit;
    }
  });
});
