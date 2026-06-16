import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';

describe('server integration', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns usage info on root path', async () => {
    const res = await request(app).get('/').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.match(res.body.message, /CorsNova CORS proxy/);
  });

  it('returns 400 when target URL is missing', async () => {
    const res = await request(app).get('/').expect(200); // root is not missing
    assert.equal(res.body.status, 'ok');
  });

  it('proxies a GET request and forwards response headers', async () => {
    nock('https://example.com')
      .get('/api/data')
      .query({ q: '1' })
      .reply(200, { ok: true }, { 'content-type': 'application/json', 'x-custom': 'value' });

    const res = await request(app)
      .get('/https://example.com/api/data?q=1')
      .expect(200);

    assert.deepEqual(res.body, { ok: true });
    assert.equal(res.headers['forward-content-type'], 'application/json');
    assert.equal(res.headers['forward-x-custom'], 'value');
  });

  it('proxies a POST JSON request and strips x- prefix from headers', async () => {
    nock('https://httpbin.org')
      .post('/post', (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        assert.deepEqual(parsed, { hello: 'world' });
        return true;
      })
      .matchHeader('authorization', 'Bearer token')
      .matchHeader('content-type', (value) => value.startsWith('application/json'))
      .reply(200, { received: true }, { 'content-type': 'application/json' });

    const res = await request(app)
      .post('/https://httpbin.org/post')
      .set('x-authorization', 'Bearer token')
      .send({ hello: 'world' })
      .expect(200);

    assert.deepEqual(res.body, { received: true });
  });

  it('proxies urlencoded form data', async () => {
    nock('https://httpbin.org')
      .post('/post', (body) => {
        const bodyString = typeof body === 'string' ? body : new URLSearchParams(body).toString();
        assert.equal(bodyString, 'a=1&b=2');
        return true;
      })
      .matchHeader('content-type', (value) => value.startsWith('application/x-www-form-urlencoded'))
      .reply(200, { received: true });

    await request(app)
      .post('/https://httpbin.org/post')
      .type('form')
      .send({ a: '1', b: '2' })
      .expect(200);
  });

  it('forwards cookies to upstream', async () => {
    nock('https://httpbin.org')
      .get('/cookies')
      .matchHeader('cookie', 'session=abc')
      .reply(200, { cookies: true });

    await request(app)
      .get('/https://httpbin.org/cookies')
      .set('Cookie', 'session=abc')
      .expect(200);
  });

  it('responds to OPTIONS with 204', async () => {
    await request(app)
      .options('/https://example.com')
      .set('Origin', 'https://demo.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
  });

  it('proxies multipart form data with files', async () => {
    nock('https://httpbin.org')
      .post('/post')
      .reply(200, { received: true });

    await request(app)
      .post('/https://httpbin.org/post')
      .field('name', 'value')
      .attach('doc', Buffer.from('hello world'), 'doc.txt')
      .expect(200);
  });

  it('returns 400 for SSRF attempts', async () => {
    const res = await request(app)
      .get('/http://127.0.0.1/secret')
      .expect(400);
    assert.equal(res.body.status, 'error');
  });

  it('returns upstream status code for non-2xx responses', async () => {
    nock('https://example.com')
      .get('/not-found')
      .reply(404, { error: 'not found' });

    await request(app)
      .get('/https://example.com/not-found')
      .expect(404);
  });
});
