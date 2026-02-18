const clientesRepo = require('../repositories/clientes.repository');

function obtenerTurnos(clienteId, user) {
  const cliente = clientesRepo.getById(clienteId);

  if (!cliente) {
    const error = new Error('Cliente no encontrado');
    error.status = 404;
    throw error;
  }

  if (user.role === 'admin') {
    return clientesRepo.getTurnos(clienteId);
  }

  return clientesRepo.getTurnosByClienteYBarbero(clienteId, user.barber_id);
}

module.exports = { obtenerTurnos };
