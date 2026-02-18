const express = require('express');
const router = express.Router();

const turnosController = require('../controllers/turnos.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

router.get(
  '/todos',
  authMiddleware,
  roleMiddleware(['admin', 'barbero', 'barber']),
  turnosController.getTodos
);
router.get(
  '/fecha/:fecha/:barberId',
  authMiddleware,
  roleMiddleware(['admin', 'barbero', 'barber']),
  turnosController.getPorFecha
);
router.get(
  '/fecha/:fecha',
  authMiddleware,
  roleMiddleware(['admin', 'barbero', 'barber']),
  turnosController.getPorFecha
);
router.get('/disponibilidad/:fecha', turnosController.getDisponibilidad);
router.post('/', turnosController.create);
router.delete('/:id', turnosController.remove);
router.get('/recordatorio/activo/:cliente_id', turnosController.getRecordatorioActivo);
router.post('/recordatorio/:id/responder', turnosController.responderRecordatorio);

module.exports = router;
