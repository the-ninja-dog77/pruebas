const db = require('../database');

function getById(id) {
  return db
    .prepare('SELECT * FROM clientes WHERE id = ?')
    .get(id);
}

function ensureExists(id, nombre = 'Cliente WhatsApp') {
  const exists = getById(id);
  if (exists) return exists;

  db.prepare(
    'INSERT INTO clientes (id, nombre, estado) VALUES (?, ?, ?)'
  ).run(id, nombre, 'idle');

  return getById(id);
}

function getTurnos(clienteId) {
  return db
    .prepare('SELECT * FROM turnos WHERE cliente_id = ?')
    .all(clienteId);
}

function getTurnosByClienteIds(clienteIds = []) {
  const ids = Array.from(new Set((clienteIds || []).filter(Boolean)));
  if (!ids.length) return [];

  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM turnos WHERE cliente_id IN (${placeholders})`)
    .all(...ids);
}

function getTurnosByClienteYBarbero(clienteId, barberId) {
  return db
    .prepare('SELECT * FROM turnos WHERE cliente_id = ? AND barber_id = ?')
    .all(clienteId, barberId);
}

function updateEstado(clienteId, estado) {
  return db
    .prepare('UPDATE clientes SET estado = ? WHERE id = ?')
    .run(estado, clienteId);
}

module.exports = {
  getById,
  ensureExists,
  getTurnos,
  getTurnosByClienteIds,
  getTurnosByClienteYBarbero,
  updateEstado,
};
