import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSessionByToken } from './db';

export type AuthContext = {
  Variables: {
    user: any;
  }
};

export async function requireAuth(c: Context<AuthContext>, next: Next) {
  const sessionToken = getCookie(c, 'session');
  
  const fail = () => {
    if (c.req.header('Accept')?.includes('text/html')) {
      return c.redirect('/login');
    }
    return c.json({ error: 'Unauthorized' }, 401);
  };

  if (!sessionToken) return fail();

  const user = getSessionByToken(sessionToken);
  if (!user) return fail();

  // Attach user to context
  c.set('user', user);
  
  // CSRF validation for state-changing methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
    // Skip CSRF for login/signup which generate tokens
    if (c.req.path.startsWith('/auth/signup') || c.req.path.startsWith('/auth/login')) {
      await next();
      return;
    }

    const csrfFromHeader = c.req.header('X-CSRF-Token');
    const body = await c.req.parseBody();
    const csrfFromBody = body.csrf_token;
    const csrfToken = csrfFromHeader || csrfFromBody;
    
    if (!csrfToken || csrfToken !== user.csrf_token) {
      return c.json({ error: 'Invalid CSRF token' }, 403);
    }
  }

  await next();
}
