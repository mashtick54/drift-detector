import { Context, Next } from 'hono';
import { getApiKeyByKey } from './db';

export type AuthContext = {
  Variables: {
    apiKey: any;
  }
};

export async function apiKeyMiddleware(c: Context<AuthContext>, next: Next) {
  const key = c.req.header('X-API-Key');
  if (!key) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  const apiKeyRow = getApiKeyByKey(key);
  if (!apiKeyRow) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  c.set('apiKey', apiKeyRow);
  await next();
}

export async function adminSecretMiddleware(c: Context, next: Next) {
  const secret = c.req.header('X-Admin-Secret');
  const adminSecret = process.env.ADMIN_SECRET;

  if (!secret || !adminSecret || secret !== adminSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
}
