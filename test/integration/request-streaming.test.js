import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { Readable } from 'node:stream';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('request body streaming', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('forwards text/plain bodies (previously dropped)', async () => {
    nock('https://httpbin.org')
      .post('/post', 'hello upstream')
      .matchHeader('content-type', (value) => value.startsWith('text/plain'))
      .reply(200, { received: true });

    const res = await request(app)
      .post('/https://httpbin.org/post')
      .set('Content-Type', 'text/plain')
      .send('hello upstream')
      .expect(200);

    assert.deepEqual(res.body, { received: true });
  });

  it('forwards binary octet-stream bodies byte-for-byte', async () => {
    const payload = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0x00, 0x01]);
    nock('https://httpbin.org')
      .post('/bin', (body) => Buffer.from(body, 'hex').equals(payload) || Buffer.from(body).equals(payload))
      .reply(200, { received: true });

    await request(app)
      .post('/https://httpbin.org/bin')
      .set('Content-Type', 'application/octet-stream')
      .send(payload)
      .expect(200);
  });

  it('forwards malformed JSON verbatim instead of rejecting it', async () => {
    nock('https://httpbin.org')
      .post('/post', '{not json')
      .reply(400, { upstream: 'rejected' });

    const res = await request(app)
      .post('/https://httpbin.org/post')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);

    assert.deepEqual(res.body, { upstream: 'rejected' });
  });

  it('proxies a DELETE without a body', async () => {
    nock('https://httpbin.org').delete('/thing').reply(204);
    await request(app).delete('/https://httpbin.org/thing').expect(204);
  });

  it('returns 413 when a chunked body exceeds the limit mid-stream', async () => {
    nock('https://example.com').post('/upload').reply(200, { ok: true });
    const server = await listen();
    try {
      const { port } = server.address();
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/https://example.com/upload',
          headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
        }, (response) => {
          let data = '';
          response.on('data', (c) => { data += c; });
          response.on('end', () => resolve({ status: response.statusCode, body: data }));
        });
        req.on('error', reject);
        const chunk = Buffer.alloc(512 * 1024, 0x61);
        for (let i = 0; i < 10; i++) req.write(chunk); // 5 MB
        req.end();
      });
      assert.equal(res.status, 413);
      assert.equal(JSON.parse(res.body).status, 'error');
    } finally {
      server.close();
    }
  });
});

describe('client disconnects', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => {
    mock.restoreAll();
    nock.cleanAll();
  });

  it('aborts the upstream fetch when the client goes away', async () => {
    const upstream = new Readable({
      read() {
        setTimeout(() => this.push(Buffer.alloc(16 * 1024, 0x62)), 20);
      },
    });
    nock('https://example.com')
      .get('/endless')
      .reply(200, () => upstream, { 'content-type': 'application/octet-stream' });

    // nock's mocked responses ignore cancellation, so assert on the signal the
    // proxy hands to fetch; with a real upstream that signal tears down the socket.
    let upstreamSignal;
    const realFetch = globalThis.fetch;
    mock.method(globalThis, 'fetch', (url, options) => {
      upstreamSignal = options.signal;
      return realFetch(url, options);
    });

    const server = await listen();
    try {
      // A raw socket keeps nock from intercepting the client side of the test.
      await new Promise((resolve, reject) => {
        const socket = net.connect(server.address().port, '127.0.0.1', () => {
          socket.write('GET /https://example.com/endless HTTP/1.1\r\nHost: localhost\r\n\r\n');
        });
        socket.once('data', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', reject);
      });

      await new Promise((r) => setTimeout(r, 100));
      assert.ok(upstreamSignal, 'fetch should have been called');
      assert.equal(upstreamSignal.aborted, true);
      assert.equal(upstreamSignal.reason.name, 'AbortError');
    } finally {
      upstream.destroy();
      server.close();
    }
  });
});
