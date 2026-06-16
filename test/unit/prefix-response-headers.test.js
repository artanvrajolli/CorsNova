import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prefixResponseHeaders } from '../../lib/prefix-response-headers.js';

describe('prefixResponseHeaders', () => {
  it('prefixes every header', () => {
    const headers = new Headers();
    headers.set('content-type', 'application/json');
    headers.set('x-custom', 'value');

    const out = prefixResponseHeaders(headers);
    assert.equal(out['Forward-content-type'], 'application/json');
    assert.equal(out['Forward-x-custom'], 'value');
  });

  it('preserves multiple set-cookie values as an array', () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'a=1');
    headers.append('Set-Cookie', 'b=2');

    const out = prefixResponseHeaders(headers);
    assert.ok(Array.isArray(out['Forward-set-cookie']));
    assert.deepEqual(out['Forward-set-cookie'], ['a=1', 'b=2']);
  });
});
