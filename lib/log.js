export function logRequest({ requestId, method, target, status, durMs }) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    requestId,
    method,
    target,
    status,
    durMs,
  }));
}
