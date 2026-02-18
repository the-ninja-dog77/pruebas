const clientesService = require('../services/clientes.service');

function getTurnos(req, res, next) {
  try {
    const { cliente_id } = req.params;
    const result = clientesService.obtenerTurnos(cliente_id, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getTurnos };
