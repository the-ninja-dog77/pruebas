const db = require('../database');

function getDaySummary({ barberId, fecha, hora }) {
  return db
    .prepare(
      `
      SELECT
        COUNT(*) AS totalTurnos,
        SUM(CASE WHEN completado = 1 THEN 1 ELSE 0 END) AS atendidosHoy,
        SUM(CASE WHEN hora >= ? THEN 1 ELSE 0 END) AS pendientesHoy,
        COALESCE(SUM(CASE WHEN completado = 1 THEN total ELSE 0 END), 0) AS ingresosHoy
      FROM turnos
      WHERE barber_id = ? AND fecha = ?
      `
    )
    .get(hora, hora, barberId, fecha);
}

function getNextTurno({ barberId, fecha, hora }) {
  return db
    .prepare(
      `
      SELECT id, cliente, servicio, fecha, hora, total, metodo_pago
      FROM turnos
      WHERE barber_id = ?
        AND (fecha > ? OR (fecha = ? AND hora >= ?))
      ORDER BY fecha ASC, hora ASC
      LIMIT 1
      `
    )
    .get(barberId, fecha, fecha, hora);
}

function getMonthCounts({ barberId, month }) {
  return db
    .prepare(
      `
      SELECT fecha, COUNT(*) AS cantidad
      FROM turnos
      WHERE barber_id = ?
        AND fecha LIKE ?
      GROUP BY fecha
      ORDER BY fecha ASC
      `
    )
    .all(barberId, `${month}%`);
}

function getTurnosByDay({ barberId, fecha }) {
  return db
    .prepare(
      `
      SELECT
        id, cliente, servicio, fecha, hora, origen, precio, total, metodo_pago,
        completado, completado_at
      FROM turnos
      WHERE barber_id = ? AND fecha = ?
      ORDER BY hora ASC
      `
    )
    .all(barberId, fecha);
}

function getTurnosByRange({ barberId, fromDate, toDate }) {
  return db
    .prepare(
      `
      SELECT
        id, cliente, servicio, fecha, hora, origen, precio, total, metodo_pago,
        completado, completado_at
      FROM turnos
      WHERE barber_id = ?
        AND fecha >= ?
        AND fecha <= ?
      ORDER BY fecha ASC, hora ASC
      `
    )
    .all(barberId, fromDate, toDate);
}

module.exports = {
  getDaySummary,
  getNextTurno,
  getMonthCounts,
  getTurnosByDay,
  getTurnosByRange,
};
