process.env.VERCEL = '1';
process.env.REQUEST_TIMEOUT_MS = '500';

export const { app } = await import('../../app.js');
