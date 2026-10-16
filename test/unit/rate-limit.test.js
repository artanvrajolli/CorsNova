import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, sweepBuckets, _resetBuckets, _bucketCount } from '../../lib/rate-limit.js';

describe('rateLimit', () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_PER_MINUTE = '2';
  });

  function makeRes() {
    return {
      statusCode: 200,
      headers: {},
      set(key, value) {
        this.headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
  }

  it('allows requests under the limit', () => {
    const req = { headers: {}, socket: { remoteAddress: '1.2.3.4' } };
    let called = false;
    rateLimit(req, makeRes(), () => { called = true; });
    assert.equal(called, true);
  });

  it('blocks requests over the limit and sets Retry-After', () => {
    const req = { headers: {}, socket: { remoteAddress: '1.2.3.4' } };
    rateLimit(req, makeRes(), () => {});
    rateLimit(req, makeRes(), () => {});

    const res = makeRes();
    rateLimit(req, res, () => {});
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.status, 'error');
    assert.ok(Number(res.headers['Retry-After']) > 0);
  });

  it('uses x-forwarded-for when present', () => {
    const req = { headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }, socket: { remoteAddress: '1.2.3.4' } };
    let called = false;
    rateLimit(req, makeRes(), () => { called = true; });
    assert.equal(called, true);
  });
});

describe('rateLimit bucket eviction', () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_PER_MINUTE = '100';
    _resetBuckets();
  });

  afterEach(() => {
    mock.timers.reset();
    _resetBuckets();
  });

  it('sweeps buckets whose window has expired', () => {
    mock.timers.enable({ apis: ['Date'] });
    const res = { set() {}, status() { return this; }, json() { return this; } };
    for (let i = 0; i < 5; i++) {
      rateLimit({ headers: {}, socket: { remoteAddress: `10.1.0.${i}` } }, res, () => {});
    }
    assert.equal(_bucketCount(), 5);

    sweepBuckets();
    assert.equal(_bucketCount(), 5, 'live buckets are kept');

    mock.timers.tick(60_001);
    sweepBuckets();
    assert.equal(_bucketCount(), 0, 'expired buckets are removed');
  });
});
