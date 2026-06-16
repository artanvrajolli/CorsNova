import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';
import { app } from '../helpers/load-app.js';

describe('binary media handling', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('proxies a PNG image response byte-for-byte', async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    nock('https://example.com')
      .get('/image.png')
      .reply(200, image, { 'content-type': 'image/png', 'content-length': String(image.length) });

    const res = await request(app)
      .get('/https://example.com/image.png')
      .buffer(true)
      .expect(200);

    assert.ok(Buffer.isBuffer(res.body));
    assert.ok(res.body.equals(image));
    assert.equal(res.headers['forward-content-type'], 'image/png');
  });

  it('proxies a small MP4 video response byte-for-byte', async () => {
    const video = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    nock('https://example.com')
      .get('/video.mp4')
      .reply(200, video, { 'content-type': 'video/mp4', 'content-length': String(video.length) });

    const res = await request(app)
      .get('/https://example.com/video.mp4')
      .buffer(true)
      .expect(200);

    assert.ok(Buffer.isBuffer(res.body));
    assert.ok(res.body.equals(video));
    assert.equal(res.headers['forward-content-type'], 'video/mp4');
  });

  it('uploads an image file via multipart', async () => {
    const image = Buffer.alloc(256 * 1024, 0x42); // 256 KB placeholder image
    nock('https://httpbin.org')
      .post('/upload', (body) => {
        // The raw multipart body should contain the file bytes.
        return Buffer.from(body).includes(image);
      })
      .reply(200, { received: true });

    const res = await request(app)
      .post('/https://httpbin.org/upload')
      .attach('photo', image, 'photo.png')
      .expect(200);

    assert.deepEqual(res.body, { received: true });
  });

  it('uploads a small video file via multipart', async () => {
    const video = Buffer.alloc(512 * 1024, 0x7a); // 512 KB placeholder video
    nock('https://httpbin.org')
      .post('/upload', (body) => Buffer.from(body).includes(video))
      .reply(200, { received: true });

    const res = await request(app)
      .post('/https://httpbin.org/upload')
      .attach('clip', video, 'clip.mp4')
      .expect(200);

    assert.deepEqual(res.body, { received: true });
  });
});
