const barberPanelService = require('../services/barberPanel.service');
const { crearTurnoPanelSchema } = require('../validators');

function resolveBarberId(req) {
  if (req.user.role === 'admin') {
    return Number(req.query.barberId || 1);
  }
  return Number(req.user.barber_id);
}

function getSummary(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    res.json(barberPanelService.getSummary(barberId));
  } catch (err) {
    next(err);
  }
}

function getCalendar(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const month = req.query.month;
    res.json(barberPanelService.getCalendar(barberId, month));
  } catch (err) {
    next(err);
  }
}

function getDay(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const { fecha } = req.params;
    res.json(barberPanelService.getDay(barberId, fecha));
  } catch (err) {
    next(err);
  }
}

function getBotStatus(req, res, next) {
  try {
    res.json(barberPanelService.getBotStatus());
  } catch (err) {
    next(err);
  }
}

function createDayTurno(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const { fecha } = req.params;
    const { error, value } = crearTurnoPanelSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const result = barberPanelService.createDayTurno({
      barberId,
      fecha,
      hora: value.hora,
      servicio: value.servicio,
      precio: value.precio,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

function updateBotStatus(req, res, next) {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled debe ser boolean' });
    }

    res.json(barberPanelService.updateBotStatus(enabled));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
  getCalendar,
  getDay,
  createDayTurno,
  getBotStatus,
  updateBotStatus,
};
