import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTarget } from '../../lib/extract-target.js';

describe('extractTarget', () => {
  it('reads the path form', () => {
    assert.equal(extractTarget('/https://example.com/a?b=1'), 'https://example.com/a?b=1');
  });

  it('reads the query form', () => {
    assert.equal(extractTarget('/?url=https%3A%2F%2Fexample.com'), 'https%3A%2F%2Fexample.com');
  });

  it('keeps the target query string verbatim in the query form', () => {
    assert.equal(extractTarget('/?url=https://a.com/x?b=1&c=2'), 'https://a.com/x?b=1&c=2');
  });

  it('returns an empty target for the root and an empty url param', () => {
    assert.equal(extractTarget('/'), '');
    assert.equal(extractTarget('/?url='), '');
    assert.equal(extractTarget(undefined), '');
  });
});
