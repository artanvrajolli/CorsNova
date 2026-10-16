const QUERY_PREFIX = '/?url=';

// Targets can be given as a path (/https://example.com) or as a query
// parameter (/?url=https://example.com). The query form exists because
// Vercel's edge collapses the "//" in the path form and answers with a 308
// that carries no CORS headers, which browsers reject.
//
// Everything after "url=" is taken verbatim, so an unencoded target keeps its
// own query string: /?url=https://a.com/x?b=1&c=2 -> https://a.com/x?b=1&c=2
export function extractTarget(reqUrl = '/') {
  if (reqUrl.startsWith(QUERY_PREFIX)) {
    return reqUrl.slice(QUERY_PREFIX.length);
  }
  return reqUrl.slice(1);
}
