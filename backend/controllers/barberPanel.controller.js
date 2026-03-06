const barberPanelService = require('../services/barberPanel.service');
const {
  crearTurnoPanelSchema,
  addManualIncomeSchema,
} = require('../validators');

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

function removeDayTurno(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const { fecha } = req.params;
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'ID de turno invalido' });
    }

    const result = barberPanelService.removeDayTurno({
      barberId,
      fecha,
      id,
      user: req.user,
    });

    res.json(result);
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

function getBalance(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const range = String(req.query.range || 'week').toLowerCase();
    if (!['week', 'month'].includes(range)) {
      return res.status(400).json({ message: 'range debe ser week o month' });
    }

    res.json(barberPanelService.getBalance({ barberId, range }));
  } catch (err) {
    next(err);
  }
}

function updateBalanceGoal(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'amount debe ser un numero positivo' });
    }

    res.json(barberPanelService.updateBalanceGoal({ barberId, amount }));
  } catch (err) {
    next(err);
  }
}

function addExtraIncome(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const { error, value } = addManualIncomeSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    res.status(201).json(
      barberPanelService.addExtraIncome({
        barberId,
        amount: value.amount,
        concept: value.concept,
      })
    );
  } catch (err) {
    next(err);
  }
}

function downloadTodaySummaryPdf(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const fecha = String(req.query?.fecha || '').trim() || null;
    const pdf = barberPanelService.getTodaySummaryPdf(barberId, fecha);
    const targetFecha = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
      ? String(fecha)
      : barberPanelService.getSummary(barberId).fecha;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="zzeta-resumen-${targetFecha}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

function confirmTurnoCompleted(req, res, next) {
  try {
    const barberId = resolveBarberId(req);
    const turnoId = Number(req.params.id);
    if (!Number.isInteger(turnoId) || turnoId <= 0) {
      return res.status(400).json({ message: 'ID de turno invalido' });
    }

    res.json(
      barberPanelService.confirmTurnoCompleted({
        barberId,
        turnoId,
      })
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
  getCalendar,
  getDay,
  createDayTurno,
  removeDayTurno,
  getBalance,
  updateBalanceGoal,
  addExtraIncome,
  downloadTodaySummaryPdf,
  confirmTurnoCompleted,
  getBotStatus,
  updateBotStatus,
};
