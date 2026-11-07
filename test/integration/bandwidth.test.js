import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';
import { _resetBuckets } from '../../lib/rate-limit.js';

const CDN = 'vercel-cdn-cache-control';

describe('response size cap', () => {
  beforeEach(() => {
    nock.cleanAll();
    _resetBuckets();
  });
  afterEach(() => {
    nock.cleanAll();
    delete process.env.MAX_RESPONSE_BYTES;
  });

  it('answers 502 when the declared length is over the cap', async () => {
    process.env.MAX_RESPONSE_BYTES = '1024';
    nock('https://example.com')
      .get('/big')
      .reply(200, Buffer.alloc(2048), { 'content-type': 'application/octet-stream', 'content-length': '2048' });

    const res = await request(app).get('/?url=https://example.com/big').expect(502);

    assert.equal(res.body.status, 'error');
    assert.match(res.body.message, /larger than the 1 KB limit/);
    assert.ok(res.body.requestId);
    assert.equal(res.headers[CDN], undefined);
  });

  it('cuts a chunked body without content-length once it crosses the cap', async () => {
    process.env.MAX_RESPONSE_BYTES = '1024';
    nock('https://example.com')
      .get('/chunked')
      .reply(200, () => Readable.from([Buffer.alloc(800), Buffer.alloc(800)]), { 'content-type': 'text/plain' });

    await assert.rejects(request(app).get('/?url=https://example.com/chunked').buffer(true));
  });

  it('passes a body under the cap through unchanged', async () => {
    process.env.MAX_RESPONSE_BYTES = '1024';
    const body = 'y'.repeat(1000);
    nock('https://example.com').get('/small').reply(200, body, { 'content-type': 'text/plain' });

    const res = await request(app).get('/?url=https://example.com/small').buffer(true).expect(200);
    assert.equal(res.text, body);
  });

  it('lets any size through when the cap is 0', async () => {
    process.env.MAX_RESPONSE_BYTES = '0';
    const body = 'z'.repeat(8192);
    nock('https://example.com')
      .get('/any')
      .reply(200, body, { 'content-type': 'text/plain', 'content-length': String(body.length) });

    const res = await request(app).get('/?url=https://example.com/any').buffer(true).expect(200);
    assert.equal(res.text.length, body.length);
  });

  it('does not cap HEAD requests', async () => {
    process.env.MAX_RESPONSE_BYTES = '1024';
    nock('https://example.com')
      .head('/big')
      .reply(200, '', { 'content-type': 'application/octet-stream', 'content-length': '999999' });

    const res = await request(app).head('/?url=https://example.com/big').expect(200);
    assert.equal(res.headers['forward-content-length'], '999999');
  });
});

describe('CDN caching', () => {
  beforeEach(() => {
    nock.cleanAll();
    _resetBuckets();
  });
  afterEach(() => {
    nock.cleanAll();
    delete process.env.CACHE_TTL_SECONDS;
  });

  it('marks an anonymous GET cacheable with the default TTL', async () => {
    nock('https://example.com').get('/data').reply(200, { ok: true });

    const res = await request(app)
      .get('/?url=https://example.com/data')
      .set('Origin', 'https://app.test')
      .expect(200);

    assert.equal(res.headers[CDN], 'max-age=600');
    assert.match(res.headers.vary, /Origin/);
    assert.match(res.headers.vary, /X-Authorization/);
    assert.equal(res.headers['access-control-allow-origin'], 'https://app.test');
  });

  it('uses a shorter upstream max-age', async () => {
    nock('https://example.com').get('/short').reply(200, 'ok', { 'cache-control': 'public, max-age=30' });

    const res = await request(app).get('/?url=https://example.com/short').expect(200);
    assert.equal(res.headers[CDN], 'max-age=30');
  });

  it('does not cache requests with a cookie or x-authorization', async () => {
    nock('https://example.com').get('/me').times(2).reply(200, 'ok');

    const withCookie = await request(app).get('/?url=https://example.com/me').set('Cookie', 'a=1').expect(200);
    assert.equal(withCookie.headers[CDN], undefined);

    const withAuth = await request(app)
      .get('/?url=https://example.com/me')
      .set('X-Authorization', 'Bearer t')
      .expect(200);
    assert.equal(withAuth.headers[CDN], undefined);
  });

  it('does not cache POST, 500, set-cookie or no-store responses', async () => {
    nock('https://example.com')
      .post('/post').reply(200, 'ok')
      .get('/error').reply(500, 'fail')
      .get('/cookie').reply(200, 'ok', { 'set-cookie': 'sid=1' })
      .get('/nostore').reply(200, 'ok', { 'cache-control': 'no-store' });

    const post = await request(app).post('/?url=https://example.com/post').send('x');
    assert.equal(post.status, 200);
    assert.equal(post.headers[CDN], undefined);

    for (const path of ['error', 'cookie', 'nostore']) {
      const res = await request(app).get(`/?url=https://example.com/${path}`);
      assert.equal(res.headers[CDN], undefined, path);
    }
  });

  it('turns caching off with CACHE_TTL_SECONDS=0', async () => {
    process.env.CACHE_TTL_SECONDS = '0';
    nock('https://example.com').get('/data').reply(200, 'ok');

    const res = await request(app).get('/?url=https://example.com/data').expect(200);
    assert.equal(res.headers[CDN], undefined);
  });
});
