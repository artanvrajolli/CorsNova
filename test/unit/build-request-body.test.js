import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestBody } from '../../lib/build-request-body.js';

describe('buildRequestBody', () => {
  it('returns null body for GET', () => {
    const { body, contentType } = buildRequestBody({ method: 'GET', headers: {} });
    assert.equal(body, null);
    assert.equal(contentType, undefined);
  });

  it('returns null body for HEAD', () => {
    const { body, contentType } = buildRequestBody({ method: 'HEAD', headers: {} });
    assert.equal(body, null);
    assert.equal(contentType, undefined);
  });

  it('stringifies JSON bodies and supplies content type', () => {
    const { body, contentType } = buildRequestBody({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { hello: 'world' },
    });
    assert.equal(body, '{"hello":"world"}');
    assert.equal(contentType, 'application/json');
  });

  it('creates URLSearchParams for urlencoded bodies', () => {
    const { body, contentType } = buildRequestBody({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { a: '1', b: '2' },
    });
    assert.ok(body instanceof URLSearchParams);
    assert.equal(body.toString(), 'a=1&b=2');
    assert.equal(contentType, undefined);
  });

  it('creates FormData for multipart bodies', () => {
    const { body, contentType } = buildRequestBody({
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----xxx' },
      body: { field: 'value' },
      files: [
        { fieldname: 'doc', buffer: Buffer.from('hello'), originalname: 'doc.txt' },
      ],
    });
    assert.ok(body instanceof FormData);
    assert.equal(contentType, undefined);
  });

  it('passes through unknown content types', () => {
    const { body, contentType } = buildRequestBody({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'raw text',
    });
    assert.equal(body, 'raw text');
    assert.equal(contentType, undefined);
  });

  it('returns undefined when nothing parsed the request', () => {
    const { body, contentType } = buildRequestBody({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    });
    assert.equal(body, undefined);
    assert.equal(contentType, undefined);
  });
});
