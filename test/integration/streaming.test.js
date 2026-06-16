import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';
import { Readable } from 'node:stream';
import { app } from '../helpers/load-app.js';

describe('streaming responses', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('streams a large response body', async () => {
    const payload = 'x'.repeat(1024 * 1024); // 1 MB
    nock('https://example.com')
      .get('/large')
      .reply(200, () => Readable.from([payload]), { 'content-type': 'text/plain' });

    const res = await request(app)
      .get('/https://example.com/large')
      .buffer(true)
      .expect(200);

    assert.equal(res.text.length, payload.length);
    assert.equal(res.headers['forward-content-type'], 'text/plain');
  });

  it('returns only headers for HEAD requests', async () => {
    nock('https://example.com')
      .head('/resource')
      .reply(200, '', { 'content-type': 'application/json', 'content-length': '42' });

    const res = await request(app)
      .head('/https://example.com/resource')
      .expect(200);

    assert.equal(res.headers['forward-content-type'], 'application/json');
    assert.equal(res.headers['forward-content-length'], '42');
  });
});
