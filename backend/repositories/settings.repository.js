const db = require('../database');

function getValue(key) {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key);

  return row ? row.value : null;
}

function setValue(key, value) {
  db.prepare(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `
  ).run(key, String(value), new Date().toISOString());
}

function getBoolean(key, fallback = false) {
  const value = getValue(key);
  if (value === null || value === undefined) return fallback;

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on';
}

function setBoolean(key, enabled) {
  setValue(key, enabled ? '1' : '0');
}

module.exports = {
  getValue,
  setValue,
  getBoolean,
  setBoolean,
};
