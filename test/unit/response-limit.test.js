import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  getMaxResponseBytes,
  exceedsDeclaredLength,
  limitBytes,
  formatBytes,
} from '../../lib/response-limit.js';

function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return { stream, bytes: () => Buffer.concat(chunks) };
}

describe('getMaxResponseBytes', () => {
  afterEach(() => {
    delete process.env.MAX_RESPONSE_BYTES;
  });

  it('defaults to 4 MB when unset or empty', () => {
    assert.equal(DEFAULT_MAX_RESPONSE_BYTES, 4 * 1024 * 1024);
    assert.equal(getMaxResponseBytes(), DEFAULT_MAX_RESPONSE_BYTES);
    process.env.MAX_RESPONSE_BYTES = '';
    assert.equal(getMaxResponseBytes(), DEFAULT_MAX_RESPONSE_BYTES);
  });

  it('returns 0 (off) for 0, negative or invalid values', () => {
    for (const value of ['0', '-5', 'abc']) {
      process.env.MAX_RESPONSE_BYTES = value;
      assert.equal(getMaxResponseBytes(), 0, value);
    }
  });

  it('reads a custom value', () => {
    process.env.MAX_RESPONSE_BYTES = '1024';
    assert.equal(getMaxResponseBytes(), 1024);
  });
});

describe('exceedsDeclaredLength', () => {
  it('is true only when content-length is over the cap', () => {
    assert.equal(exceedsDeclaredLength(new Headers({ 'content-length': '2048' }), 1024), true);
    assert.equal(exceedsDeclaredLength(new Headers({ 'content-length': '1024' }), 1024), false);
    assert.equal(exceedsDeclaredLength(new Headers(), 1024), false);
  });

  it('is false when the cap is off', () => {
    assert.equal(exceedsDeclaredLength(new Headers({ 'content-length': '999999999' }), 0), false);
  });
});

describe('limitBytes', () => {
  it('passes a body that is exactly at the cap', async () => {
    const out = sink();
    await pipeline(Readable.from([Buffer.alloc(600), Buffer.alloc(424)]), limitBytes(1024), out.stream);
    assert.equal(out.bytes().length, 1024);
  });

  it('rejects a body over the cap with RESPONSE_TOO_LARGE', async () => {
    const out = sink();
    await assert.rejects(
      pipeline(Readable.from([Buffer.alloc(600), Buffer.alloc(425)]), limitBytes(1024), out.stream),
      (err) => err.code === 'RESPONSE_TOO_LARGE' && /larger than the 1 KB limit/.test(err.message),
    );
  });
});

describe('formatBytes', () => {
  it('formats MB, KB and bytes', () => {
    assert.equal(formatBytes(4 * 1024 * 1024), '4 MB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(12), '12 bytes');
  });
});
