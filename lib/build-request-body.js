import { Readable, Transform } from 'node:stream';

export const MAX_BODY_BYTES = 4 * 1024 * 1024;

function bodyTooLarge(limit) {
  const err = new Error(`Request body exceeds the ${limit} byte limit`);
  err.code = 'BODY_TOO_LARGE';
  return err;
}

export function isBodyTooLarge(err) {
  for (let e = err; e; e = e.cause) {
    if (e.code === 'BODY_TOO_LARGE') return true;
  }
  return false;
}

// Streams the client's body straight to the upstream instead of parsing and
// re-serialising it. Every content type is forwarded byte-for-byte and the
// body is never fully buffered in memory.
export function buildRequestBody(req, { limit = MAX_BODY_BYTES } = {}) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD') {
    return { body: null };
  }

  const headers = req.headers;
  const contentType = headers['content-type'];
  const hasLength = headers['content-length'] !== undefined;

  // Per RFC 9112 a request only has a body if it declares one.
  if (!hasLength && headers['transfer-encoding'] === undefined) {
    return { body: null, contentType };
  }

  const contentLength = hasLength ? Number(headers['content-length']) : undefined;
  if (contentLength > limit) {
    throw bodyTooLarge(limit);
  }
  if (contentLength === 0) {
    return { body: null, contentType };
  }

  // Chunked bodies have no declared length, so enforce the limit while streaming.
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > limit) {
        callback(bodyTooLarge(limit));
        return;
      }
      callback(null, chunk);
    },
  });
  req.on('error', (err) => limiter.destroy(err));
  limiter.on('error', () => req.unpipe(limiter));
  req.pipe(limiter);

  return {
    body: Readable.toWeb(limiter),
    contentType,
    contentLength: hasLength ? String(contentLength) : undefined,
  };
}
