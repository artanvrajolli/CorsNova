import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';

describe('upstream timeouts', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('returns 504 when upstream hangs', async () => {
    nock('https://example.com')
      .get('/slow')
      .delayConnection(2000)
      .reply(200, { ok: true });

    const start = Date.now();
    const res = await request(app)
      .get('/https://example.com/slow')
      .expect(504);
    const elapsed = Date.now() - start;

    assert.equal(res.body.status, 'error');
    assert.equal(res.body.message, 'Upstream request timed out');
    assert.ok(elapsed < 1500, `Expected timeout under 1500ms, got ${elapsed}ms`);
  });
});
