process.env.VERCEL = '1';
process.env.REQUEST_TIMEOUT_MS = '500';

const module = await import('../../app.js');
export const app = module.default || module.app;
