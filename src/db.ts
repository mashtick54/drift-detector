import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DB_PATH = path.join(process.cwd(), 'data', 'drift.db');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    owner_email TEXT,
    name TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER,
    name TEXT,
    url TEXT,
    method TEXT,
    headers_json TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER,
    endpoint_id INTEGER,
    schema_json TEXT,
    fingerprint TEXT,
    sampled_at TEXT,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
  );

  CREATE TABLE IF NOT EXISTS diffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id INTEGER,
    endpoint_id INTEGER,
    from_snapshot_id INTEGER,
    to_snapshot_id INTEGER,
    diffs_json TEXT,
    detected_at TEXT,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id),
    FOREIGN KEY (from_snapshot_id) REFERENCES snapshots(id),
    FOREIGN KEY (to_snapshot_id) REFERENCES snapshots(id)
  );
`);

// Migrations for existing databases
try { db.exec('ALTER TABLE endpoints ADD COLUMN api_key_id INTEGER'); } catch (e) {}
try { db.exec('ALTER TABLE snapshots ADD COLUMN api_key_id INTEGER'); } catch (e) {}
try { db.exec('ALTER TABLE diffs ADD COLUMN api_key_id INTEGER'); } catch (e) {}

export function createApiKey(ownerEmail: string, name: string): any {
  const key = `dd_${crypto.randomUUID()}`;
  const stmt = db.prepare('INSERT INTO api_keys (key, owner_email, name, created_at) VALUES (?, ?, ?, ?)');
  const result = stmt.run(key, ownerEmail, name, new Date().toISOString());
  return getApiKeyById(result.lastInsertRowid);
}

export function getApiKeyByKey(key: string): any {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key);
}

export function getApiKeyById(id: number | bigint): any {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
}

export function insertEndpoint(apiKeyId: number | bigint | null, name: string, url: string, method: string, headers: object) {
  const stmt = db.prepare('INSERT INTO endpoints (api_key_id, name, url, method, headers_json, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(apiKeyId, name, url, method, JSON.stringify(headers), new Date().toISOString());
  return result.lastInsertRowid;
}

export function getEndpoints(apiKeyId?: number | bigint): any[] {
  if (apiKeyId !== undefined) {
    return db.prepare('SELECT * FROM endpoints WHERE api_key_id = ?').all(apiKeyId);
  }
  return db.prepare('SELECT * FROM endpoints').all();
}

export function insertSnapshot(apiKeyId: number | bigint | null, endpointId: number | bigint, schemaJson: string, fingerprint: string) {
  const stmt = db.prepare('INSERT INTO snapshots (api_key_id, endpoint_id, schema_json, fingerprint, sampled_at) VALUES (?, ?, ?, ?, ?)');
  const result = stmt.run(apiKeyId, endpointId, schemaJson, fingerprint, new Date().toISOString());
  return result.lastInsertRowid;
}

export function getLastSnapshot(apiKeyId: number | bigint | null, endpointId: number | bigint): any {
  if (apiKeyId !== undefined && apiKeyId !== null) {
    return db.prepare('SELECT * FROM snapshots WHERE api_key_id = ? AND endpoint_id = ? ORDER BY sampled_at DESC LIMIT 1').get(apiKeyId, endpointId);
  }
  return db.prepare('SELECT * FROM snapshots WHERE endpoint_id = ? ORDER BY sampled_at DESC LIMIT 1').get(endpointId);
}

export function insertDiff(apiKeyId: number | bigint | null, endpointId: number | bigint, fromSnapshotId: number | bigint, toSnapshotId: number | bigint, diffsJson: string) {
  const stmt = db.prepare('INSERT INTO diffs (api_key_id, endpoint_id, from_snapshot_id, to_snapshot_id, diffs_json, detected_at) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(apiKeyId, endpointId, fromSnapshotId, toSnapshotId, diffsJson, new Date().toISOString());
  return result.lastInsertRowid;
}

export function getDiffs(apiKeyId: number | bigint | null, endpointId: number | bigint): any[] {
  if (apiKeyId !== undefined && apiKeyId !== null) {
    return db.prepare('SELECT * FROM diffs WHERE api_key_id = ? AND endpoint_id = ? ORDER BY detected_at DESC').all(apiKeyId, endpointId);
  }
  return db.prepare('SELECT * FROM diffs WHERE endpoint_id = ? ORDER BY detected_at DESC').all(endpointId);
}

export function getAllDiffsWithEndpoint(apiKeyId?: number | bigint): any[] {
  let query = `
    SELECT diffs.*, endpoints.name as endpoint_name 
    FROM diffs 
    JOIN endpoints ON diffs.endpoint_id = endpoints.id 
  `;
  const params: any[] = [];
  
  if (apiKeyId !== undefined) {
    query += ` WHERE diffs.api_key_id = ? `;
    params.push(apiKeyId);
  }

  query += ` ORDER BY detected_at DESC LIMIT 20 `;
  return db.prepare(query).all(...params);
}

export function getTotalDiffsCount(apiKeyId?: number | bigint): number {
  let query = 'SELECT COUNT(*) as count FROM diffs';
  const params: any[] = [];
  
  if (apiKeyId !== undefined) {
    query += ' WHERE api_key_id = ?';
    params.push(apiKeyId);
  }

  const result = db.prepare(query).get(...params) as any;
  return result.count;
}

export function getGlobalLastChecked(apiKeyId?: number | bigint): string | null {
  let query = 'SELECT MAX(sampled_at) as last_checked FROM snapshots';
  const params: any[] = [];
  
  if (apiKeyId !== undefined) {
    query += ' WHERE api_key_id = ?';
    params.push(apiKeyId);
  }

  const result = db.prepare(query).get(...params) as any;
  return result.last_checked || null;
}
