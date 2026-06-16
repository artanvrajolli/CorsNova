import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';

describe('SSRF protection', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  const blocked = [
    'http://127.0.0.1/',
    'http://127.0.0.1:8080/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://localhost/',
    'http://0.0.0.0/',
    'file:///etc/passwd',
    'ftp://example.com',
    'gopher://example.com',
  ];

  for (const target of blocked) {
    it(`blocks ${target}`, async () => {
      const res = await request(app).get(`/${target}`).expect(400);
      assert.equal(res.body.status, 'error');
    });
  }

  it('allows a public target after blocking a private one', async () => {
    nock('https://example.com')
      .get('/ok')
      .reply(200, { ok: true });

    const res = await request(app)
      .get('/https://example.com/ok')
      .expect(200);
    assert.deepEqual(res.body, { ok: true });
  });
});
