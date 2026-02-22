const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function resolveDefaultDbPath() {
  if (process.env.NODE_ENV === 'production') {
    return '/app/data/zzeta.db';
  }
  return 'zzeta.db';
}

function resolveDbPath() {
  const configuredDbPath = process.env.DB_PATH || resolveDefaultDbPath();
  if (path.isAbsolute(configuredDbPath)) return configuredDbPath;

  if (process.env.NODE_ENV === 'production') {
    const persistentBase = process.env.PERSISTENT_DATA_DIR || '/app/data';
    return path.join(persistentBase, configuredDbPath);
  }

  return path.join(__dirname, configuredDbPath);
}

const dbPath = resolveDbPath();
const dbDir = path.dirname(dbPath);

if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
process.env.DB_PATH = dbPath;

db.exec(`
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  executed_at TEXT NOT NULL
);
`);

module.exports = db;
