const db = require('../database');

function getById(id) {
  return db
    .prepare('SELECT * FROM clientes WHERE id = ?')
    .get(id);
}

function getTurnos(clienteId) {
  return db
    .prepare('SELECT * FROM turnos WHERE cliente_id = ?')
    .all(clienteId);
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
  getTurnos,
  getTurnosByClienteYBarbero,
  updateEstado,
};
