const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || 'zzeta.db');

db.exec(`
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  executed_at TEXT NOT NULL
);
`);

module.exports = db;
