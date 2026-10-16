import express from 'express';
import { Readable, finished } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validateTargetUrl } from './lib/validate-target-url.js';
import { buildUpstreamHeaders } from './lib/build-upstream-headers.js';
import { buildRequestBody, isBodyTooLarge } from './lib/build-request-body.js';
import { prefixResponseHeaders } from './lib/prefix-response-headers.js';
import { rateLimit } from './lib/rate-limit.js';
import { logRequest } from './lib/log.js';
import { extractTarget } from './lib/extract-target.js';

const app = express();
const port = process.env.PORT || 3030;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 25_000);
const DEFAULT_UA = process.env.DEFAULT_USER_AGENT || 'CorsNova/1.0 (+https://github.com/artanvrajolli/CorsNova)';

app.disable('x-powered-by');
app.disable('etag');

function enableCORS(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Expose-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PATCH, PUT, DELETE');
  next();
}

app.use(enableCORS);

app.options('*', (req, res) => res.sendStatus(204));

app.use(rateLimit);

function sendUsage(req, res) {
  const host = req.get('host');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const example = `${proto}://${host}/?url=https://example.com`;
  return res.json({
    message: `CorsNova CORS proxy. Use: ${example}`,
    status: 'ok',
  });
}

function sendBodyTooLarge(req, res, err) {
  // Discard the rest of the upload before answering. Responding mid-upload
  // makes Node close the socket, and the client sees a reset instead of a 413.
  res.status(413);
  req.unpipe();
  finished(req, () => {
    if (!res.headersSent) {
      res.json({ status: 'error', message: err.message });
    }
  });
  req.resume();
}

app.use(async (req, res) => {
  const requestId = req.headers['x-vercel-id'] || crypto.randomUUID();
  const start = Date.now();
  let targetUrl;
  let requestBody;

  const rawTarget = extractTarget(req.url);
  // Vercel may rewrite the root path to the function entrypoint (app.js).
  if (!rawTarget || rawTarget === '/' || rawTarget === 'app.js') {
    return sendUsage(req, res);
  }

  // Check the declared body size before doing any DNS work.
  try {
    requestBody = buildRequestBody(req);
  } catch (err) {
    if (isBodyTooLarge(err)) {
      return sendBodyTooLarge(req, res, err);
    }
    return res.status(400).json({ status: 'error', message: err.message });
  }

  try {
    targetUrl = await validateTargetUrl(rawTarget);
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }

  const upstreamHeaders = buildUpstreamHeaders(req.headers, { defaultUserAgent: DEFAULT_UA });
  if (requestBody.contentType) {
    upstreamHeaders['Content-Type'] = requestBody.contentType;
  }
  if (requestBody.contentLength) {
    upstreamHeaders['Content-Length'] = requestBody.contentLength;
  }

  // Stop pulling from the upstream as soon as the client goes away.
  const clientAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) {
      clientAbort.abort();
    }
  });

  try {
    const response = await fetch(targetUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      body: requestBody.body,
      duplex: 'half',
      signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), clientAbort.signal]),
      redirect: 'follow',
    });

    res.set(prefixResponseHeaders(response.headers));
    const upstreamContentType = response.headers.get('content-type');
    if (upstreamContentType) {
      res.set('Content-Type', upstreamContentType);
    }
    res.set('Forward-Request-Id', requestId);
    res.status(response.status);

    if (req.method === 'HEAD' || !response.body) {
      return res.end();
    }

    await pipeline(Readable.fromWeb(response.body), res);
  } catch (err) {
    // The client disconnected; there is nobody left to answer.
    if (clientAbort.signal.aborted) {
      return;
    }
    if (isBodyTooLarge(err) && !res.headersSent) {
      return sendBodyTooLarge(req, res, err);
    }
    console.error(JSON.stringify({ requestId, error: err.message, stack: err.stack }));
    // Headers are already on the wire, so the only option is to cut the stream.
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
    const status = isTimeout ? 504 : 502;
    const message = isTimeout ? 'Upstream request timed out' : 'Upstream request failed';
    return res.status(status).json({ status: 'error', message, requestId });
  } finally {
    logRequest({
      requestId,
      method: req.method,
      target: targetUrl?.hostname,
      status: res.statusCode,
      durMs: Date.now() - start,
    });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`CorsNova is running on port ${port}`);
  });
}

export default app;
