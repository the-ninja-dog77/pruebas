const statsRepo = require('../repositories/stats.repository');

function getDashboard() {
  return {
    ingresos: {
      total: statsRepo.getTotalIngresos(),
      porDia: statsRepo.getIngresosPorDia(30),
    },
    turnos: {
      total: statsRepo.getTotalTurnos(),
    },
    ranking: {
      servicios: statsRepo.getRankingServicios(10),
      barberos: statsRepo.getRankingBarberos(10),
    },
  };
}

module.exports = {
  getDashboard,
};
