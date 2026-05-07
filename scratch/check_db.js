const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.cwd(), 'data', 'drift.db');
const db = new Database(dbPath);
const endpoints = db.prepare('SELECT * FROM endpoints').all();
console.log(JSON.stringify(endpoints, null, 2));
