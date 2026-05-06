import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'drift.db');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    url TEXT,
    method TEXT,
    headers_json TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id INTEGER,
    schema_json TEXT,
    fingerprint TEXT,
    sampled_at TEXT,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
  );

  CREATE TABLE IF NOT EXISTS diffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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

export function insertEndpoint(name: string, url: string, method: string, headers: object) {
  const stmt = db.prepare('INSERT INTO endpoints (name, url, method, headers_json, created_at) VALUES (?, ?, ?, ?, ?)');
  const result = stmt.run(name, url, method, JSON.stringify(headers), new Date().toISOString());
  return result.lastInsertRowid;
}

export function getEndpoints(): any[] {
  return db.prepare('SELECT * FROM endpoints').all();
}

export function insertSnapshot(endpointId: number | bigint, schemaJson: string, fingerprint: string) {
  const stmt = db.prepare('INSERT INTO snapshots (endpoint_id, schema_json, fingerprint, sampled_at) VALUES (?, ?, ?, ?)');
  const result = stmt.run(endpointId, schemaJson, fingerprint, new Date().toISOString());
  return result.lastInsertRowid;
}

export function getLastSnapshot(endpointId: number | bigint): any {
  return db.prepare('SELECT * FROM snapshots WHERE endpoint_id = ? ORDER BY sampled_at DESC LIMIT 1').get(endpointId);
}

export function insertDiff(endpointId: number | bigint, fromSnapshotId: number | bigint, toSnapshotId: number | bigint, diffsJson: string) {
  const stmt = db.prepare('INSERT INTO diffs (endpoint_id, from_snapshot_id, to_snapshot_id, diffs_json, detected_at) VALUES (?, ?, ?, ?, ?)');
  const result = stmt.run(endpointId, fromSnapshotId, toSnapshotId, diffsJson, new Date().toISOString());
  return result.lastInsertRowid;
}

export function getDiffs(endpointId: number | bigint): any[] {
  return db.prepare('SELECT * FROM diffs WHERE endpoint_id = ? ORDER BY detected_at DESC').all(endpointId);
}

export function getAllDiffsWithEndpoint(): any[] {
  return db.prepare(`
    SELECT diffs.*, endpoints.name as endpoint_name 
    FROM diffs 
    JOIN endpoints ON diffs.endpoint_id = endpoints.id 
    ORDER BY detected_at DESC 
    LIMIT 20
  `).all();
}
