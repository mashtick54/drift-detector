import { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import { 
  createUser, 
  getUserByEmail, 
  createSession, 
  deleteSession, 
  verifyUserEmail, 
  createPasswordResetToken, 
  resetPassword,
  updateUserName,
  updateUserPassword,
  getApiKeysByUser,
  deleteApiKey,
  createApiKey
} from './db';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'onboarding@resend.dev';

// Rate Limiter
const rateLimitMap = new Map<string, { attempts: number, lastAttempt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(ip);
  if (!limit) return false;
  
  if (now - limit.lastAttempt > 15 * 60 * 1000) {
    rateLimitMap.delete(ip);
    return false;
  }
  
  return limit.attempts >= 5;
}

function recordAttempt(ip: string) {
  const now = Date.now();
  const limit = rateLimitMap.get(ip) || { attempts: 0, lastAttempt: now };
  limit.attempts++;
  limit.lastAttempt = now;
  rateLimitMap.set(ip, limit);
}

async function setSessionCookie(c: Context, userId: number | bigint) {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const ua = c.req.header('user-agent') || 'unknown';
  const { rawToken, csrfToken } = createSession(userId, ip, ua);
  
  setCookie(c, 'session', rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 30 * 24 * 60 * 60,
    path: '/'
  });

  // Also set CSRF in cookie for reference in forms if needed, 
  // though we'll primarily pull it from the session row on POST
  setCookie(c, 'csrf_token', csrfToken, {
    secure: true,
    sameSite: 'Strict',
    maxAge: 30 * 24 * 60 * 60,
    path: '/'
  });
}

export const signupHandler = async (c: Context) => {
  const { email, password, name } = await c.req.parseBody() as any;
  const ip = c.req.header('x-forwarded-for') || 'unknown';

  if (!email || !password || !name || password.length < 8) {
    return c.html('Invalid input', 400); // Should be better UI but for now...
  }

  const existing = getUserByEmail(email);
  if (existing) {
    // Generic message to prevent enumeration
    return c.json({ message: "Check your email to verify your account" });
  }

  const { user, verificationToken } = createUser(email, password, name);
  
  // Send verification email
  if (process.env.RESEND_API_KEY) {
    try {
      const url = `${new URL(c.req.url).origin}/auth/verify?token=${verificationToken}`;
      await resend.emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: 'Verify your email - Drift Detector',
        html: `<p>Please verify your email by clicking <a href="${url}">here</a>.</p>`
      });
      console.log(`Verification email sent to ${user.email}`);
    } catch (err) {
      console.error('Failed to send verification email:', err);
    }
  }

  await setSessionCookie(c, user.id);

  if (c.req.header('Accept')?.includes('text/html')) {
    return c.redirect('/');
  }

  return c.json({ message: "Check your email to verify your account" });
};

export const loginHandler = async (c: Context) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  if (isRateLimited(ip)) {
    return c.json({ error: "Too many attempts. Please wait 15 minutes." }, 429);
  }

  const { email, password } = await c.req.parseBody() as any;
  if (!email || !password) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const user = getUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordAttempt(ip);
    return c.json({ error: "Invalid email or password" }, 401);
  }

  if (!user.email_verified) {
    // Resend verification email logic could go here
    return c.json({ error: "Please verify your email before logging in." }, 403);
  }

  await setSessionCookie(c, user.id);
  
  if (c.req.header('Accept')?.includes('text/html')) {
    return c.redirect('/');
  }

  return c.json({ 
    message: "Logged in", 
    user: { id: user.id, email: user.email, name: user.name, plan: user.plan } 
  });
};

export const logoutHandler = async (c: Context) => {
  const sessionToken = c.req.header('cookie')?.match(/session=([^;]+)/)?.[1];
  if (sessionToken) {
    deleteSession(sessionToken);
  }
  deleteCookie(c, 'session');
  deleteCookie(c, 'csrf_token');

  if (c.req.header('Accept')?.includes('text/html')) {
    return c.redirect('/login');
  }

  return c.json({ message: "Logged out" });
};

export const verifyHandler = async (c: Context) => {
  const token = c.req.query('token');
  if (token && verifyUserEmail(token)) {
    return c.redirect('/login?verified=1');
  }
  return c.html('<h1>Invalid or expired token</h1>', 400);
};

export const forgotPasswordHandler = async (c: Context) => {
  const { email } = await c.req.parseBody() as any;
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  
  if (isRateLimited(ip)) {
    return c.json({ error: "Too many attempts" }, 429);
  }
  recordAttempt(ip);

  const resetToken = createPasswordResetToken(email);
  if (resetToken && process.env.RESEND_API_KEY) {
    try {
      const url = `${new URL(c.req.url).origin}/reset-password?token=${resetToken}`;
      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Reset your password - Drift Detector',
        html: `<p>Reset your password by clicking <a href="${url}">here</a>.</p>`
      });
      console.log(`Password reset email sent to ${email}`);
    } catch (err) {
      console.error('Failed to send password reset email:', err);
    }
  }

  return c.json({ message: "If that email exists you will receive a reset link" });
};

export const updateNameHandler = async (c: Context) => {
  const user = c.get('user');
  const { name } = await c.req.parseBody() as any;
  if (name) {
    updateUserName(user.id, name);
    return c.redirect('/profile?updated=1');
  }
  return c.redirect('/profile?error=1');
};

const passwordChangeLimitMap = new Map<number | bigint, { attempts: number, lastAttempt: number }>();

export const updatePasswordHandler = async (c: Context) => {
  const user = c.get('user');
  const { currentPassword, newPassword, confirmPassword } = await c.req.parseBody() as any;
  
  // Rate limit
  const limit = passwordChangeLimitMap.get(user.id) || { attempts: 0, lastAttempt: 0 };
  if (limit.attempts >= 3 && Date.now() - limit.lastAttempt < 3600000) {
    return c.redirect('/profile?error=rate_limit');
  }

  if (newPassword !== confirmPassword || newPassword.length < 8) {
    return c.redirect('/profile?error=invalid_new_password');
  }

  const userRow = getUserByEmail(user.email);
  if (!bcrypt.compareSync(currentPassword, userRow.password_hash)) {
    limit.attempts++;
    limit.lastAttempt = Date.now();
    passwordChangeLimitMap.set(user.id, limit);
    return c.redirect('/profile?error=invalid_current_password');
  }

  updateUserPassword(user.id, bcrypt.hashSync(newPassword, 12));
  passwordChangeLimitMap.delete(user.id);
  return c.redirect('/login?reset=1'); // Force re-login
};

export const generateKeyHandler = async (c: Context) => {
  const user = c.get('user');
  const { name } = await c.req.parseBody() as any;
  const apiKey = createApiKey(user.id, user.email, name || 'Default Key');
  return c.redirect(`/profile?new_key=${apiKey.key}`);
};

export const revokeKeyHandler = async (c: Context) => {
  const user = c.get('user');
  const { id } = c.req.param();
  deleteApiKey(user.id, Number(id));
  return c.redirect('/profile?revoked=1');
};

export const resetPasswordHandler = async (c: Context) => {
  const { token, password } = await c.req.parseBody() as any;
  if (!token || !password || password.length < 8) {
    return c.json({ error: "Invalid input" }, 400);
  }

  if (resetPassword(token, password)) {
    return c.json({ message: "Password reset successfully" });
  }
  return c.json({ error: "Invalid or expired token" }, 400);
};
