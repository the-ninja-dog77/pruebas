const db = require('../database');

function getTotalTurnos() {
  return db
    .prepare('SELECT COUNT(*) as count FROM turnos')
    .get().count;
}

function getTotalIngresos() {
  return db
    .prepare('SELECT COALESCE(SUM(total), 0) as total FROM turnos')
    .get().total;
}

function getIngresosPorDia(limit = 30) {
  return db
    .prepare(`
      SELECT fecha, COALESCE(SUM(total), 0) as total
      FROM turnos
      GROUP BY fecha
      ORDER BY fecha DESC
      LIMIT ?
    `)
    .all(limit);
}

function getRankingServicios(limit = 10) {
  return db
    .prepare(`
      SELECT servicio, COUNT(*) as cantidad, COALESCE(SUM(total), 0) as ingreso
      FROM turnos
      GROUP BY servicio
      ORDER BY ingreso DESC, cantidad DESC
      LIMIT ?
    `)
    .all(limit);
}

function getRankingBarberos(limit = 10) {
  return db
    .prepare(`
      SELECT barber_id, COUNT(*) as cantidad, COALESCE(SUM(total), 0) as ingreso
      FROM turnos
      GROUP BY barber_id
      ORDER BY ingreso DESC, cantidad DESC
      LIMIT ?
    `)
    .all(limit);
}

module.exports = {
  getTotalTurnos,
  getTotalIngresos,
  getIngresosPorDia,
  getRankingServicios,
  getRankingBarberos,
};
