import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const DB_PATH = path.join(process.cwd(), 'data', 'drift.db');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);

// Initialize tables (Drop and recreate cleanly for development)
db.exec(`
  DROP TABLE IF EXISTS diffs;
  DROP TABLE IF EXISTS snapshots;
  DROP TABLE IF EXISTS endpoints;
  DROP TABLE IF EXISTS api_keys;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS subscriptions;
  DROP TABLE IF EXISTS processed_events;

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    email_verified INTEGER DEFAULT 0,
    verification_token_hash TEXT,
    reset_token_hash TEXT,
    reset_token_expires TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key TEXT UNIQUE NOT NULL,
    owner_email TEXT,
    name TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    api_key_id INTEGER,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    method TEXT NOT NULL,
    headers_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  );

  CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint_id INTEGER NOT NULL,
    schema_json TEXT,
    fingerprint TEXT,
    sampled_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
  );

  CREATE TABLE diffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint_id INTEGER NOT NULL,
    from_snapshot_id INTEGER,
    to_snapshot_id INTEGER,
    diffs_json TEXT,
    detected_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id),
    FOREIGN KEY (from_snapshot_id) REFERENCES snapshots(id),
    FOREIGN KEY (to_snapshot_id) REFERENCES snapshots(id)
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    paystack_customer_id TEXT,
    paystack_subscription_code TEXT,
    plan TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    current_period_end TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS processed_events (
    id TEXT PRIMARY KEY,
    processed_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Utility to hash tokens for DB storage
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// USER REPOSITORY
export function createUser(email: string, password: string, name: string) {
  const cleanEmail = email.trim().toLowerCase();
  const passwordHash = bcrypt.hashSync(password, 12);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationTokenHash = hashToken(verificationToken);

  const stmt = db.prepare(`
    INSERT INTO users (email, password_hash, name, verification_token_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(cleanEmail, passwordHash, name, verificationTokenHash, new Date().toISOString());
  const user = getUserById(result.lastInsertRowid);
  return { user, verificationToken };
}

export function getUserByEmail(email: string) {
  const cleanEmail = email.trim().toLowerCase();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
}

export function getUserById(id: number | bigint) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
}

export function verifyUserEmail(token: string) {
  const tokenHash = hashToken(token);
  const user = db.prepare('SELECT * FROM users WHERE verification_token_hash = ?').get(tokenHash) as any;
  
  if (user) {
    db.prepare('UPDATE users SET email_verified = 1, verification_token_hash = NULL WHERE id = ?').run(user.id);
    return true;
  }
  return false;
}

export function updateUserName(id: number | bigint, name: string) {
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
}

export function updateUserPlan(id: number | bigint, plan: string) {
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, id);
}

export function updateUserPassword(id: number | bigint, passwordHash: string) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  // Invalidate all sessions except current? For now delete all as per previous reset logic
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

export function createPasswordResetToken(email: string) {
  const user = getUserByEmail(email);
  if (!user) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour

  db.prepare('UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?')
    .run(tokenHash, expires, user.id);
  
  return token;
}

export function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const user = db.prepare('SELECT * FROM users WHERE reset_token_hash = ? AND reset_token_expires > ?').get(tokenHash, now) as any;

  if (user) {
    const passwordHash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?').run(passwordHash, user.id);
    // Invalidate all sessions for this user
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    return true;
  }
  return false;
}

// SESSION REPOSITORY
export function createSession(userId: number | bigint, ipAddress: string, userAgent: string) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, created_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, tokenHash, csrfToken, expiresAt, new Date().toISOString(), ipAddress, userAgent);

  return { rawToken, csrfToken };
}

export function getSessionByToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const now = new Date().toISOString();
  
  const session = db.prepare(`
    SELECT users.*, sessions.id as session_id, sessions.csrf_token, sessions.expires_at 
    FROM sessions 
    JOIN users ON sessions.user_id = users.id 
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, now) as any;

  return session;
}

export function deleteSession(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

// API KEY REPOSITORY
export function createApiKey(userId: number | bigint, ownerEmail: string, name: string): any {
  const key = `dd_${crypto.randomUUID()}`;
  const stmt = db.prepare('INSERT INTO api_keys (user_id, key, owner_email, name, created_at) VALUES (?, ?, ?, ?, ?)');
  const result = stmt.run(userId, key, ownerEmail, name, new Date().toISOString());
  return getApiKeyById(result.lastInsertRowid);
}

export function getApiKeyByKey(key: string): any {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key);
}

export function getApiKeyById(id: number | bigint): any {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
}

export function getApiKeysByUser(userId: number | bigint): any[] {
  return db.prepare('SELECT * FROM api_keys WHERE user_id = ?').all(userId);
}

export function deleteApiKey(userId: number | bigint, id: number | bigint) {
  db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, userId);
}

// DATA REPOSITORY
export function insertEndpoint(userId: number | bigint, apiKeyId: number | bigint | null, name: string, url: string, method: string, headers: object) {
  const stmt = db.prepare(`
    INSERT INTO endpoints (user_id, api_key_id, name, url, method, headers_json, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, apiKeyId, name, url, method, JSON.stringify(headers), new Date().toISOString());
  return result.lastInsertRowid;
}

export function getEndpoints(userId?: number | bigint): any[] {
  if (userId !== undefined) {
    return db.prepare('SELECT * FROM endpoints WHERE user_id = ?').all(userId);
  }
  return db.prepare('SELECT * FROM endpoints').all();
}

export function deleteEndpoint(userId: number | bigint, id: number | bigint) {
  db.prepare('DELETE FROM diffs WHERE endpoint_id = ?').run(id);
  db.prepare('DELETE FROM snapshots WHERE endpoint_id = ?').run(id);
  db.prepare('DELETE FROM endpoints WHERE id = ? AND user_id = ?').run(id, userId);
}

// BILLING REPOSITORY
export function createSubscription(userId: number | bigint, plan: string, customerId?: string, subCode?: string) {
  db.prepare(`
    INSERT INTO subscriptions (user_id, plan, paystack_customer_id, paystack_subscription_code) 
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET 
      plan = excluded.plan, 
      paystack_customer_id = COALESCE(excluded.paystack_customer_id, paystack_customer_id),
      paystack_subscription_code = COALESCE(excluded.paystack_subscription_code, paystack_subscription_code)
  `).run(userId, plan, customerId || null, subCode || null);
  updateUserPlan(userId, plan);
}

export function getSubscriptionByUserId(userId: number | bigint): any {
  return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
}

export function updateSubscription(userId: number | bigint, fields: any) {
  const keys = Object.keys(fields);
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k]);
  db.prepare(`UPDATE subscriptions SET ${sets} WHERE user_id = ?`).run(...values, userId);
  if (fields.plan) updateUserPlan(userId, fields.plan);
}

export function isEventProcessed(eventId: string): boolean {
  const row = db.prepare('SELECT 1 FROM processed_events WHERE id = ?').get(eventId);
  return !!row;
}

export function markEventProcessed(eventId: string) {
  db.prepare('INSERT INTO processed_events (id) VALUES (?)').run(eventId);
}

export function insertSnapshot(userId: number | bigint, endpointId: number | bigint, schemaJson: string, fingerprint: string) {
  const stmt = db.prepare(`
    INSERT INTO snapshots (user_id, endpoint_id, schema_json, fingerprint, sampled_at) 
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, endpointId, schemaJson, fingerprint, new Date().toISOString());
  return result.lastInsertRowid;
}

export function getLastSnapshot(userId: number | bigint, endpointId: number | bigint): any {
  return db.prepare('SELECT * FROM snapshots WHERE user_id = ? AND endpoint_id = ? ORDER BY sampled_at DESC LIMIT 1').get(userId, endpointId);
}

export function insertDiff(userId: number | bigint, endpointId: number | bigint, fromSnapshotId: number | bigint, toSnapshotId: number | bigint, diffsJson: string) {
  const stmt = db.prepare(`
    INSERT INTO diffs (user_id, endpoint_id, from_snapshot_id, to_snapshot_id, diffs_json, detected_at) 
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(userId, endpointId, fromSnapshotId, toSnapshotId, diffsJson, new Date().toISOString());
  return result.lastInsertRowid;
}

export function getDiffs(userId: number | bigint, endpointId: number | bigint): any[] {
  return db.prepare('SELECT * FROM diffs WHERE user_id = ? AND endpoint_id = ? ORDER BY detected_at DESC').all(userId, endpointId);
}

export function getAllDiffsWithEndpoint(userId?: number | bigint): any[] {
  let query = `
    SELECT diffs.*, endpoints.name as endpoint_name 
    FROM diffs 
    JOIN endpoints ON diffs.endpoint_id = endpoints.id 
  `;
  const params: any[] = [];
  
  if (userId !== undefined) {
    query += ` WHERE diffs.user_id = ? `;
    params.push(userId);
  }

  query += ` ORDER BY detected_at DESC LIMIT 20 `;
  return db.prepare(query).all(...params);
}

export function getTotalDiffsCount(userId?: number | bigint): number {
  let query = 'SELECT COUNT(*) as count FROM diffs';
  const params: any[] = [];
  
  if (userId !== undefined) {
    query += ' WHERE user_id = ?';
    params.push(userId);
  }

  const result = db.prepare(query).get(...params) as any;
  return result.count;
}

export function getGlobalLastChecked(userId?: number | bigint): string | null {
  let query = 'SELECT MAX(sampled_at) as last_checked FROM snapshots';
  const params: any[] = [];
  
  if (userId !== undefined) {
    query += ' WHERE user_id = ?';
    params.push(userId);
  }

  const result = db.prepare(query).get(...params) as any;
  return result.last_checked || null;
}
