const DEFAULT_USER_AGENT = 'CorsNova/1.0';

export function buildUpstreamHeaders(clientHeaders, { defaultUserAgent = DEFAULT_USER_AGENT } = {}) {
  const headers = {};

  if (clientHeaders.cookie) {
    headers.Cookie = clientHeaders.cookie;
  }

  for (const [key, value] of Object.entries(clientHeaders)) {
    if (key.toLowerCase().startsWith('x-')) {
      const newKey = key.replace(/^x-/i, '');
      if (newKey) {
        headers[newKey] = value;
      }
    }
  }

  const userAgent = clientHeaders['x-user-agent'] ?? clientHeaders['user-agent'] ?? defaultUserAgent;
  headers['User-Agent'] = userAgent;

  return headers;
}
