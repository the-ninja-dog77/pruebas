const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const clientesController = require('../controllers/clientes.controller');

const router = express.Router();

router.get(
  '/:cliente_id/turnos',
  authMiddleware,
  roleMiddleware(['admin', 'barbero', 'barber']),
  clientesController.getTurnos
);

module.exports = router;
