import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';

describe('CORS behaviour', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('reflects origin and sets credentials when origin is present', async () => {
    nock('https://example.com').get('/').reply(200, {});

    const res = await request(app)
      .get('/https://example.com/')
      .set('Origin', 'https://demo.com')
      .expect(200);

    assert.equal(res.headers['access-control-allow-origin'], 'https://demo.com');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  });

  it('does not set credentials when origin is absent', async () => {
    nock('https://example.com').get('/').reply(200, {});

    const res = await request(app)
      .get('/https://example.com/')
      .expect(200);

    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.notEqual(res.headers['access-control-allow-credentials'], 'true');
  });

  it('exposes all forwarded headers', async () => {
    nock('https://example.com')
      .get('/')
      .reply(200, {}, { 'x-custom': 'value' });

    const res = await request(app)
      .get('/https://example.com/')
      .expect(200);

    assert.equal(res.headers['access-control-expose-headers'], '*');
  });
});
