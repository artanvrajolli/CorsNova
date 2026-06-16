export function prefixResponseHeaders(headers) {
  const out = {};

  for (const [key, value] of headers.entries()) {
    const prefixedKey = 'Forward-' + key;
    if (key.toLowerCase() === 'set-cookie' && typeof headers.getSetCookie === 'function') {
      out[prefixedKey] = headers.getSetCookie();
    } else {
      out[prefixedKey] = value;
    }
  }

  return out;
}
