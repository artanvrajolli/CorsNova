import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTargetUrl } from '../../lib/validate-target-url.js';

describe('validateTargetUrl', () => {
  it('accepts a plain https URL', async () => {
    const url = await validateTargetUrl('https://example.com/path?q=1');
    assert.equal(url.href, 'https://example.com/path?q=1');
  });

  it('accepts a plain http URL', async () => {
    const url = await validateTargetUrl('http://example.com/');
    assert.equal(url.href, 'http://example.com/');
  });

  it('decodes a fully encoded URL', async () => {
    const url = await validateTargetUrl('https%3A%2F%2Fexample.com%2Fapi');
    assert.equal(url.href, 'https://example.com/api');
  });

  it('rejects missing URL', async () => {
    await assert.rejects(() => validateTargetUrl(''), /Target URL is required/);
  });

  it('rejects an invalid URL', async () => {
    await assert.rejects(() => validateTargetUrl('not a url'), /Invalid target URL/);
  });

  it('rejects non-http/https protocols', async () => {
    await assert.rejects(() => validateTargetUrl('file:///etc/passwd'), /Only http and https targets are allowed/);
    await assert.rejects(() => validateTargetUrl('ftp://example.com'), /Only http and https targets are allowed/);
    await assert.rejects(() => validateTargetUrl('gopher://example.com'), /Only http and https targets are allowed/);
  });

  it('rejects embedded credentials', async () => {
    await assert.rejects(() => validateTargetUrl('https://user:pass@example.com'), /Embedded credentials are not allowed/);
  });

  it('rejects loopback IPv4 addresses', async () => {
    await assert.rejects(() => validateTargetUrl('http://127.0.0.1/'), /Private or internal target addresses are not allowed/);
    await assert.rejects(() => validateTargetUrl('http://127.255.255.255/'), /Private or internal target addresses are not allowed/);
  });

  it('rejects private IPv4 ranges', async () => {
    await assert.rejects(() => validateTargetUrl('http://10.0.0.1/'), /Private or internal target addresses are not allowed/);
    await assert.rejects(() => validateTargetUrl('http://172.16.0.1/'), /Private or internal target addresses are not allowed/);
    await assert.rejects(() => validateTargetUrl('http://192.168.1.1/'), /Private or internal target addresses are not allowed/);
    await assert.rejects(() => validateTargetUrl('http://169.254.169.254/latest/meta-data/'), /Private or internal target addresses are not allowed/);
  });

  it('rejects 0.0.0.0 and broadcast', async () => {
    await assert.rejects(() => validateTargetUrl('http://0.0.0.0/'), /Private or internal target addresses are not allowed/);
    await assert.rejects(() => validateTargetUrl('http://255.255.255.255/'), /Private or internal target addresses are not allowed/);
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    await assert.rejects(() => validateTargetUrl('http://localhost/'), /Private or internal target addresses are not allowed/);
  });
});
