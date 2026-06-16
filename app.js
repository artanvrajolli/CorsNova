import express from 'express';
import multer from 'multer';
import { Readable } from 'node:stream';
import { validateTargetUrl } from './lib/validate-target-url.js';
import { buildUpstreamHeaders } from './lib/build-upstream-headers.js';
import { buildRequestBody } from './lib/build-request-body.js';
import { prefixResponseHeaders } from './lib/prefix-response-headers.js';
import { rateLimit } from './lib/rate-limit.js';
import { logRequest } from './lib/log.js';

const app = express();
const port = process.env.PORT || 3030;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 25_000);
const DEFAULT_UA = process.env.DEFAULT_USER_AGENT || 'CorsNova/1.0 (+https://github.com/artanvrajolli/CorsNova)';

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
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ limit: '4mb', extended: true }));

// Convert body-parser errors into JSON so the proxy never sends Express HTML.
app.use((err, req, res, next) => {
  if (err && err.type && err.type.startsWith('entity.')) {
    const status = err.type === 'entity.too.large' ? 413 : 400;
    return res.status(status).json({ status: 'error', message: err.message });
  }
  next(err);
});

const upload = multer({ limits: { fileSize: 4 * 1024 * 1024 } });

function multipartParser(req, res, next) {
  const ct = req.headers['content-type'] ?? '';
  if (ct.toLowerCase().startsWith('multipart/form-data')) {
    return upload.any()(req, res, next);
  }
  next();
}

app.options('*', (req, res) => res.sendStatus(204));

app.use(rateLimit);
app.use(multipartParser);

function sendUsage(req, res) {
  const host = req.get('host');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const example = `${proto}://${host}/https://example.com`;
  return res.json({
    message: `CorsNova CORS proxy. Use: ${example}`,
    status: 'ok',
  });
}

app.use(async (req, res) => {
  const requestId = req.headers['x-vercel-id'] || crypto.randomUUID();
  const start = Date.now();
  let targetUrl;

  try {
    const rawTarget = (req.url || '/').slice(1);
    // Vercel may rewrite the root path to the function entrypoint (app.js).
    if (!rawTarget || rawTarget === '/' || rawTarget === 'app.js') {
      return sendUsage(req, res);
    }
    targetUrl = await validateTargetUrl(rawTarget);
  } catch (err) {
    return res.status(400).json({ status: 'error', message: err.message });
  }

  const upstreamHeaders = buildUpstreamHeaders(req.headers, { defaultUserAgent: DEFAULT_UA });
  const { body, contentType: requestContentType } = buildRequestBody(req);
  if (requestContentType) {
    upstreamHeaders['Content-Type'] = requestContentType;
  }

  try {
    const response = await fetch(targetUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });

    const responseHeaders = prefixResponseHeaders(response.headers);
    for (const [key, value] of Object.entries(responseHeaders)) {
      res.set(key, value);
    }
    const upstreamContentType = response.headers.get('content-type');
    if (upstreamContentType) {
      res.set('Content-Type', upstreamContentType);
    }
    res.set('Forward-Request-Id', requestId);

    if (req.method === 'HEAD') {
      return res.status(response.status).end();
    }

    res.status(response.status);
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
    const status = isTimeout ? 504 : 502;
    const message = isTimeout ? 'Upstream request timed out' : 'Upstream request failed';
    console.error(JSON.stringify({ requestId, error: err.message, stack: err.stack }));
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
