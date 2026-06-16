export function buildRequestBody(req) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD') {
    return { body: null };
  }

  const contentType = (req.headers['content-type'] ?? '').toLowerCase();

  if (contentType.startsWith('application/json')) {
    return { body: JSON.stringify(req.body), contentType: 'application/json' };
  }

  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    return { body: new URLSearchParams(req.body) };
  }

  if (contentType.startsWith('multipart/form-data')) {
    const form = new FormData();
    if (req.body && typeof req.body === 'object') {
      for (const [key, value] of Object.entries(req.body)) {
        form.append(key, value);
      }
    }
    for (const file of req.files || []) {
      form.append(file.fieldname, new Blob([file.buffer]), file.originalname);
    }
    return { body: form };
  }

  // Unknown content type: pass through whatever the body parser produced,
  // or undefined if nothing parsed the request.
  return { body: req.body ?? undefined };
}
