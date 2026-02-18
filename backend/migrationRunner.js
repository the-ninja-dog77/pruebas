const fs = require('fs');
const path = require('path');
const db = require('./database');

function runMigrations() {
  const migrationsPath = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsPath)
    .filter(file => file.endsWith('.js'))
    .sort();

  const executed = db
    .prepare('SELECT name FROM migrations')
    .all()
    .map(m => m.name);

  files.forEach(file => {
    if (!executed.includes(file)) {
      console.log(`📦 Ejecutando migración: ${file}`);

      const migration = require(path.join(migrationsPath, file));
      migration.up(db);

      db.prepare(
        'INSERT INTO migrations (name, executed_at) VALUES (?, ?)'
      ).run(file, new Date().toISOString());
    }
  });
}

module.exports = runMigrations;
