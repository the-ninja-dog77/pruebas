const db = require('../database');

function getAll() {
  return db.prepare('SELECT * FROM turnos').all();
}

function getAllByBarberId(barberId) {
  return db
    .prepare('SELECT * FROM turnos WHERE barber_id = ?')
    .all(barberId);
}

function getByFecha(fecha, barberId = null) {
  if (barberId === null || barberId === undefined) {
    return db
      .prepare('SELECT * FROM turnos WHERE fecha = ?')
      .all(fecha);
  }
  return db
    .prepare('SELECT * FROM turnos WHERE fecha = ? AND barber_id = ?')
    .all(fecha, barberId);
}

function getById(id) {
  return db.prepare('SELECT * FROM turnos WHERE id = ?').get(id);
}

function create(data) {
  const stmt = db.prepare(`
    INSERT INTO turnos
    (barber_id, cliente_id, cliente, servicio, fecha, hora, origen, precio, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.barber_id,
    data.cliente_id,
    data.cliente,
    data.servicio,
    data.fecha,
    data.hora,
    data.origen,
    data.precio,
    data.total
  );

  return getById(result.lastInsertRowid);
}

function remove(id) {
  return db.prepare('DELETE FROM turnos WHERE id = ?').run(id);
}

function getHorasByFecha(fecha) {
  return db
    .prepare('SELECT hora FROM turnos WHERE fecha = ?')
    .all(fecha);
}

function getHorasByFechaAndBarber(fecha, barberId) {
  return db
    .prepare('SELECT hora FROM turnos WHERE fecha = ? AND barber_id = ?')
    .all(fecha, barberId);
}

function getPendientesRecordatorio() {
  return db
    .prepare('SELECT * FROM turnos WHERE recordatorioEnviado = 0')
    .all();
}

function marcarRecordatorioEnviado(id) {
  return db
    .prepare(
      'UPDATE turnos SET recordatorioEnviado = 1, esperandoRespuesta = 1 WHERE id = ?'
    )
    .run(id);
}

function getRecordatorioActivoPorCliente(clienteId) {
  return db
    .prepare(
      'SELECT * FROM turnos WHERE esperandoRespuesta = 1 AND cliente_id = ?'
    )
    .get(clienteId);
}

function clearEsperandoRespuesta(id) {
  return db
    .prepare('UPDATE turnos SET esperandoRespuesta = 0 WHERE id = ?')
    .run(id);
}

module.exports = {
  getAll,
  getAllByBarberId,
  getByFecha,
  getById,
  create,
  remove,
  getHorasByFecha,
  getHorasByFechaAndBarber,
  getPendientesRecordatorio,
  marcarRecordatorioEnviado,
  getRecordatorioActivoPorCliente,
  clearEsperandoRespuesta,
};
