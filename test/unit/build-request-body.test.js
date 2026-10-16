import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buildRequestBody, isBodyTooLarge, MAX_BODY_BYTES } from '../../lib/build-request-body.js';

function makeReq({ method = 'POST', headers = {}, chunks = [] } = {}) {
  const req = Readable.from(chunks.map((c) => Buffer.from(c)));
  req.method = method;
  req.headers = headers;
  return req;
}

async function readAll(webStream) {
  return Buffer.from(await new Response(webStream).arrayBuffer());
}

describe('buildRequestBody', () => {
  it('returns null body for GET', () => {
    const { body, contentType } = buildRequestBody(makeReq({ method: 'GET' }));
    assert.equal(body, null);
    assert.equal(contentType, undefined);
  });

  it('returns null body for HEAD', () => {
    const { body, contentType } = buildRequestBody(makeReq({ method: 'HEAD' }));
    assert.equal(body, null);
    assert.equal(contentType, undefined);
  });

  it('returns null body when the request declares no body', () => {
    const { body } = buildRequestBody(makeReq({ method: 'DELETE', headers: {} }));
    assert.equal(body, null);
  });

  it('returns null body for an explicit zero content-length', () => {
    const { body, contentType } = buildRequestBody(makeReq({
      headers: { 'content-type': 'application/json', 'content-length': '0' },
    }));
    assert.equal(body, null);
    assert.equal(contentType, 'application/json');
  });

  it('streams the raw bytes and keeps content type and length', async () => {
    const json = '{"hello":"world"}';
    const { body, contentType, contentLength } = buildRequestBody(makeReq({
      headers: { 'content-type': 'application/json', 'content-length': String(json.length) },
      chunks: [json],
    }));
    assert.ok(body instanceof ReadableStream);
    assert.equal(contentType, 'application/json');
    assert.equal(contentLength, String(json.length));
    assert.equal((await readAll(body)).toString(), json);
  });

  it('keeps the multipart boundary in the forwarded content type', () => {
    const ct = 'multipart/form-data; boundary=----xxx';
    const { contentType } = buildRequestBody(makeReq({
      headers: { 'content-type': ct, 'content-length': '5' },
      chunks: ['hello'],
    }));
    assert.equal(contentType, ct);
  });

  it('streams chunked bodies of any content type without a content length', async () => {
    const { body, contentType, contentLength } = buildRequestBody(makeReq({
      headers: { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' },
      chunks: ['raw ', 'text'],
    }));
    assert.equal(contentType, 'text/plain');
    assert.equal(contentLength, undefined);
    assert.equal((await readAll(body)).toString(), 'raw text');
  });

  it('throws BODY_TOO_LARGE when the declared length exceeds the limit', () => {
    assert.throws(
      () => buildRequestBody(makeReq({ headers: { 'content-length': String(MAX_BODY_BYTES + 1) } })),
      (err) => isBodyTooLarge(err),
    );
  });

  it('errors the stream when a chunked body exceeds the limit', async () => {
    const { body } = buildRequestBody(
      makeReq({ headers: { 'transfer-encoding': 'chunked' }, chunks: ['12345', '67890'] }),
      { limit: 8 },
    );
    await assert.rejects(readAll(body), (err) => isBodyTooLarge(err));
  });

  it('detects BODY_TOO_LARGE through an error cause chain', () => {
    const inner = Object.assign(new Error('too big'), { code: 'BODY_TOO_LARGE' });
    assert.equal(isBodyTooLarge(new TypeError('fetch failed', { cause: inner })), true);
    assert.equal(isBodyTooLarge(new Error('other')), false);
  });
});
