import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamHeaders } from '../../lib/build-upstream-headers.js';

describe('buildUpstreamHeaders', () => {
  it('strips x- prefix from custom headers', () => {
    const headers = buildUpstreamHeaders({
      'x-authorization': 'Bearer token',
      'x-api-key': 'secret',
    });
    assert.equal(headers.authorization, 'Bearer token');
    assert.equal(headers['api-key'], 'secret');
  });

  it('is case-insensitive when stripping x-', () => {
    const headers = buildUpstreamHeaders({
      'X-Authorization': 'Bearer token',
    });
    assert.equal(headers.Authorization, 'Bearer token');
  });

  it('forwards cookies', () => {
    const headers = buildUpstreamHeaders({
      cookie: 'session=abc; user=me',
    });
    assert.equal(headers.Cookie, 'session=abc; user=me');
  });

  it('does not forward non-x headers', () => {
    const headers = buildUpstreamHeaders({
      origin: 'https://evil.com',
      host: 'localhost',
      'content-type': 'application/json',
    });
    assert.equal(headers.Origin, undefined);
    assert.equal(headers.Host, undefined);
    assert.equal(headers['Content-Type'], undefined);
  });

  it('uses x-user-agent when provided', () => {
    const headers = buildUpstreamHeaders({
      'user-agent': 'Browser/1.0',
      'x-user-agent': 'CustomAgent/2.0',
    });
    assert.equal(headers['user-agent'], 'CustomAgent/2.0');
  });

  it('falls back to default user agent', () => {
    const headers = buildUpstreamHeaders({});
    assert.equal(headers['user-agent'], 'CorsNova/1.0');
  });

  it('allows overriding default user agent', () => {
    const headers = buildUpstreamHeaders({}, { defaultUserAgent: 'MyBot/1' });
    assert.equal(headers['user-agent'], 'MyBot/1');
  });
});
