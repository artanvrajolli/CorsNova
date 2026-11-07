import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CACHE_TTL_SECONDS,
  getCacheTtlSeconds,
  isRequestCacheable,
  cacheTtlFor,
} from '../../lib/cache-policy.js';

function req(method, headers = {}) {
  return { method, headers };
}

function upstream(status, headers = {}) {
  return { status, headers: new Headers(headers) };
}

describe('isRequestCacheable', () => {
  it('accepts a plain GET and HEAD', () => {
    assert.equal(isRequestCacheable(req('GET', { accept: '*/*', origin: 'https://app.test' })), true);
    assert.equal(isRequestCacheable(req('HEAD')), true);
  });

  it('ignores Vercel platform headers', () => {
    const headers = {
      'x-vercel-id': 'fra1::abc',
      'x-forwarded-for': '1.2.3.4',
      'x-forwarded-proto': 'https',
      'x-real-ip': '1.2.3.4',
      'x-invocation-id': 'abc',
      'x-matched-path': '/app.js',
    };
    assert.equal(isRequestCacheable(req('GET', headers)), true);
  });

  it('rejects POST', () => {
    assert.equal(isRequestCacheable(req('POST')), false);
  });

  it('rejects cookie, authorization, range and custom x- headers', () => {
    for (const name of ['cookie', 'authorization', 'range', 'x-authorization', 'x-user-agent']) {
      assert.equal(isRequestCacheable(req('GET', { [name]: 'v' })), false, name);
    }
  });
});

describe('cacheTtlFor', () => {
  const max = 600;

  it('uses the default TTL when the upstream says nothing', () => {
    assert.equal(cacheTtlFor(upstream(200), max), 600);
  });

  it('lets a shorter max-age or s-maxage win', () => {
    assert.equal(cacheTtlFor(upstream(200, { 'cache-control': 'public, max-age=30' }), max), 30);
    assert.equal(cacheTtlFor(upstream(200, { 'cache-control': 'max-age=30, s-maxage=120' }), max), 120);
    assert.equal(cacheTtlFor(upstream(200, { 'cache-control': 'max-age=86400' }), max), 600);
  });

  it('returns 0 for max-age=0', () => {
    assert.equal(cacheTtlFor(upstream(200, { 'cache-control': 'max-age=0' }), max), 0);
  });

  it('returns 0 for no-store, no-cache, private, set-cookie and vary: *', () => {
    assert.equal(cacheTtlFor(upstream(200, { 'cache-control': 'no-store' }), max), 0);
    assert.equal(cacheTtlFor(upstream(200, { 'cache-control': 'no-cache' }), max), 0);
    assert.equal(cacheTtlFor(upstream(200, { 'cache-control': 'private, max-age=60' }), max), 0);
    assert.equal(cacheTtlFor(upstream(200, { 'set-cookie': 'a=1' }), max), 0);
    assert.equal(cacheTtlFor(upstream(200, { vary: '*' }), max), 0);
  });

  it('caches 404 but not 500 or 201', () => {
    assert.equal(cacheTtlFor(upstream(404), max), 600);
    assert.equal(cacheTtlFor(upstream(500), max), 0);
    assert.equal(cacheTtlFor(upstream(201), max), 0);
  });

  it('returns 0 when the max TTL is 0', () => {
    assert.equal(cacheTtlFor(upstream(200), 0), 0);
  });
});

describe('getCacheTtlSeconds', () => {
  afterEach(() => {
    delete process.env.CACHE_TTL_SECONDS;
  });

  it('defaults to 600, reads custom values and treats 0 or invalid as off', () => {
    assert.equal(getCacheTtlSeconds(), DEFAULT_CACHE_TTL_SECONDS);
    assert.equal(DEFAULT_CACHE_TTL_SECONDS, 600);
    process.env.CACHE_TTL_SECONDS = '120';
    assert.equal(getCacheTtlSeconds(), 120);
    process.env.CACHE_TTL_SECONDS = '0';
    assert.equal(getCacheTtlSeconds(), 0);
    process.env.CACHE_TTL_SECONDS = 'soon';
    assert.equal(getCacheTtlSeconds(), 0);
  });
});
