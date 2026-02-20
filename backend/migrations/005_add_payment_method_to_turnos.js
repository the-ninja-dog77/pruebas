module.exports.up = function (db) {
  const columns = db.prepare('PRAGMA table_info(turnos)').all();
  const hasMetodoPago = columns.some(c => c.name === 'metodo_pago');

  if (!hasMetodoPago) {
    db.exec('ALTER TABLE turnos ADD COLUMN metodo_pago TEXT');
  }
};
