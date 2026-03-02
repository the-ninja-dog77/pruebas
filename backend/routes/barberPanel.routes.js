const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const barberPanelController = require('../controllers/barberPanel.controller');

const router = express.Router();
const ALLOWED_ROLES = ['admin', 'barbero', 'barber'];

router.use(authMiddleware, roleMiddleware(ALLOWED_ROLES));

router.get('/summary', barberPanelController.getSummary);
router.get('/calendar', barberPanelController.getCalendar);
router.get('/day/:fecha', barberPanelController.getDay);
router.post('/day/:fecha/turnos', barberPanelController.createDayTurno);
router.delete('/day/:fecha/turnos/:id', barberPanelController.removeDayTurno);
router.post('/turnos/:id/complete', barberPanelController.confirmTurnoCompleted);
router.get('/balance', barberPanelController.getBalance);
router.patch('/balance-goal', barberPanelController.updateBalanceGoal);
router.get('/bot-status', barberPanelController.getBotStatus);
router.patch('/bot-status', barberPanelController.updateBotStatus);

module.exports = router;
