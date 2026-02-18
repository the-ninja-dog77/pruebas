module.exports.up = function (db) {
  const columns = db.prepare(`PRAGMA table_info(turnos)`).all();
  const hasPrecio = columns.some(c => c.name === 'precio');
  const hasTotal = columns.some(c => c.name === 'total');

  if (!hasPrecio) {
    db.exec(
      `ALTER TABLE turnos ADD COLUMN precio INTEGER NOT NULL DEFAULT 0`
    );
  }

  if (!hasTotal) {
    db.exec(
      `ALTER TABLE turnos ADD COLUMN total INTEGER NOT NULL DEFAULT 0`
    );
  }
};
