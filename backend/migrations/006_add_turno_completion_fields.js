module.exports.up = function (db) {
  const columns = db.prepare('PRAGMA table_info(turnos)').all();
  const hasCompletado = columns.some(c => c.name === 'completado');
  const hasCompletadoAt = columns.some(c => c.name === 'completado_at');

  if (!hasCompletado) {
    db.exec('ALTER TABLE turnos ADD COLUMN completado INTEGER NOT NULL DEFAULT 0');
  }

  if (!hasCompletadoAt) {
    db.exec('ALTER TABLE turnos ADD COLUMN completado_at TEXT');
  }
};
