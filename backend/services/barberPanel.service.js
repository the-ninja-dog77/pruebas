const barberPanelRepo = require('../repositories/barberPanel.repository');
const settingsRepo = require('../repositories/settings.repository');
const clientesRepo = require('../repositories/clientes.repository');
const turnosService = require('./turnos.service');
const businessHours = require('./businessHours.service');
const businessTime = require('./businessTime.service');

function pad2(v) {
  return String(v).padStart(2, '0');
}

function nowLocalParts() {
  return businessTime.getNowParts();
}

const COMPLETION_PROMPT_MINUTES = Number(process.env.BARBER_COMPLETION_PROMPT_MINUTES || 10);
const COMPLETION_NO_NEXT_DELAY_MINUTES = Number(process.env.BARBER_COMPLETION_NO_NEXT_DELAY_MINUTES || 30);
const COMPLETION_NO_NEXT_WINDOW_MINUTES = Number(process.env.BARBER_COMPLETION_NO_NEXT_WINDOW_MINUTES || 90);
const DEFAULT_BALANCE_GOAL = Number(process.env.DEFAULT_BALANCE_GOAL || 2000000);

function getBalanceGoalKey(barberId) {
  return `balance_goal_barber_${barberId}`;
}

function getDateRange(range) {
  const nowParts = nowLocalParts();
  const end = nowParts.fecha;
  const [year, month, dayOfMonth] = String(nowParts.fecha)
    .split('-')
    .map(v => Number(v));
  const now = new Date(year, month - 1, dayOfMonth);
  if (range === 'month') {
    const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
    return { from, to: end, range: 'month' };
  }

  const weekday = now.getDay(); // 0=domingo
  const diffToMonday = (weekday + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - diffToMonday);
  const from = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
  return { from, to: end, range: 'week' };
}

function parseGoalValue(value, fallback = DEFAULT_BALANCE_GOAL) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Number(fallback);
  return Math.round(n);
}

function buildCompletionPrompt({ agendaHoy, nextTurno, nowParts }) {
  const agenda = Array.isArray(agendaHoy) ? agendaHoy : [];
  if (!agenda.length) return null;
  const pending = agenda.filter(t => Number(t.completado || 0) !== 1);
  if (!pending.length) return null;

  if (nextTurno) {
    const diffToNext = businessTime.diffMinutes(nextTurno.fecha, nextTurno.hora, nowParts);
    if (diffToNext !== null && diffToNext >= 0 && diffToNext <= COMPLETION_PROMPT_MINUTES) {
      const beforeNext = pending.filter(t => String(t.hora || '') < String(nextTurno.hora || ''));
      if (beforeNext.length) {
        const target = beforeNext[0];
        return {
          mode: 'before_next',
          turnoId: target.id,
          cliente: target.cliente,
          servicio: target.servicio,
          fecha: target.fecha,
          hora: target.hora,
          total: Number(target.total || 0),
          minutesToNext: diffToNext,
        };
      }
    }
  }

  // Fallback sin "proximo turno": pregunta igual cuando ya paso un rato
  // desde el inicio del turno para no dejar la confirmacion colgada.
  const candidates = pending.filter(t => {
      const diff = businessTime.diffMinutes(t.fecha, t.hora, nowParts);
      if (diff === null) return false;
      const minutesAfterStart = -diff;
      return (
        minutesAfterStart >= COMPLETION_NO_NEXT_DELAY_MINUTES &&
        minutesAfterStart <= COMPLETION_NO_NEXT_DELAY_MINUTES + COMPLETION_NO_NEXT_WINDOW_MINUTES
      );
    });

  if (!candidates.length) return null;
  const turno = candidates[0];
  const diff = businessTime.diffMinutes(turno.fecha, turno.hora, nowParts);
  if (diff === null) return null;

  return {
    mode: 'after_turno',
    turnoId: turno.id,
    cliente: turno.cliente,
    servicio: turno.servicio,
    fecha: turno.fecha,
    hora: turno.hora,
    total: Number(turno.total || 0),
    minutesToNext: 0,
    minutesAfterStart: -diff,
  };
}

function getSummary(barberId) {
  const nowParts = nowLocalParts();
  const { fecha, hora } = nowParts;
  const summary = barberPanelRepo.getDaySummary({ barberId, fecha, hora }) || {};
  const nextTurno = barberPanelRepo.getNextTurno({ barberId, fecha, hora }) || null;
  const agendaHoy = barberPanelRepo.getTurnosByDay({ barberId, fecha });
  const completionPrompt = buildCompletionPrompt({
    agendaHoy,
    nextTurno,
    nowParts,
  });

  return {
    fecha,
    totalTurnosHoy: Number(summary.totalTurnos || 0),
    atendidosHoy: Number(summary.atendidosHoy || 0),
    pendientesHoy: Number(summary.pendientesHoy || 0),
    ingresosHoy: Number(summary.ingresosHoy || 0),
    proximoTurno: nextTurno,
    completionPrompt,
  };
}

function getCalendar(barberId, month) {
  const selectedMonth =
    /^\d{4}-\d{2}$/.test(String(month || '')) ?
      String(month) :
      nowLocalParts().fecha.slice(0, 7);

  return {
    month: selectedMonth,
    counts: barberPanelRepo.getMonthCounts({ barberId, month: selectedMonth }),
    weeklyHours: businessHours.getWeeklyHoursDisplay(),
  };
}

function getDay(barberId, fecha) {
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''));
  if (!isValidDate) {
    const err = new Error('Fecha invalida. Usa formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }

  const agenda = barberPanelRepo.getTurnosByDay({ barberId, fecha });
  const disponibles = turnosService.obtenerDisponibilidad(fecha, barberId).disponibles;
  const rule = businessHours.getRuleForDate(fecha);

  return {
    fecha,
    dayName: rule.dayName,
    businessHours: rule.label,
    agenda,
    disponibles,
  };
}

function buildPanelClienteId({ barberId, fecha, hora }) {
  return `panel-${barberId}-${fecha}-${hora.replace(':', '')}-${Date.now()}`;
}

function createDayTurno({ barberId, fecha, hora, servicio, precio }) {
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''));
  if (!isValidDate) {
    const err = new Error('Fecha invalida. Usa formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }

  const isValidHour = /^\d{2}:\d{2}$/.test(String(hora || ''));
  if (!isValidHour) {
    const err = new Error('Hora invalida. Usa formato HH:MM.');
    err.status = 400;
    throw err;
  }

  const servicioLimpio = String(servicio || '').trim();
  if (!servicioLimpio) {
    const err = new Error('Servicio requerido.');
    err.status = 400;
    throw err;
  }

  const precioNumero = Number(precio);
  if (!Number.isFinite(precioNumero) || precioNumero < 0) {
    const err = new Error('Precio invalido.');
    err.status = 400;
    throw err;
  }

  const disponibles = turnosService.obtenerDisponibilidad(fecha, barberId).disponibles;
  if (!disponibles.includes(hora)) {
    const err = new Error('Ese horario ya no esta disponible.');
    err.status = 409;
    throw err;
  }

  const cliente = 'Cliente de mostrador';
  const clienteId = buildPanelClienteId({ barberId, fecha, hora });
  clientesRepo.ensureExists(clienteId, cliente);

  return turnosService.crearTurno({
    barber_id: barberId,
    cliente_id: clienteId,
    cliente,
    servicio: servicioLimpio,
    fecha,
    hora,
    origen: 'panel',
    precio: Math.round(precioNumero),
  });
}

function removeDayTurno({ barberId, fecha, id, user }) {
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''));
  if (!isValidDate) {
    const err = new Error('Fecha invalida. Usa formato YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }

  const dayAgenda = barberPanelRepo.getTurnosByDay({ barberId, fecha });
  const target = dayAgenda.find(t => Number(t.id) === Number(id));
  if (!target) {
    const err = new Error('Turno no encontrado para ese dia.');
    err.status = 404;
    throw err;
  }

  turnosService.eliminarTurno({
    id: target.id,
    user,
  });

  return {
    message: 'Turno eliminado',
    turno: {
      id: target.id,
      fecha: target.fecha,
      hora: target.hora,
      cliente: target.cliente,
      servicio: target.servicio,
    },
  };
}

function getBalance({ barberId, range }) {
  const dateRange = getDateRange(range);
  const rows = barberPanelRepo.getTurnosByRange({
    barberId,
    fromDate: dateRange.from,
    toDate: dateRange.to,
  });
  const completados = rows.filter(r => Number(r.completado || 0) === 1);
  const amount = completados.reduce((acc, r) => acc + Number(r.total || 0), 0);
  const goal = parseGoalValue(settingsRepo.getValue(getBalanceGoalKey(barberId)));
  const progress = goal > 0 ? Math.min(100, (amount / goal) * 100) : 0;

  return {
    range: dateRange.range,
    from: dateRange.from,
    to: dateRange.to,
    confirmedTurnos: completados.length,
    amount,
    goal,
    progressPercent: Number(progress.toFixed(2)),
  };
}

function updateBalanceGoal({ barberId, amount }) {
  const parsed = parseGoalValue(amount);
  settingsRepo.setValue(getBalanceGoalKey(barberId), String(parsed));
  return {
    barberId,
    goal: parsed,
  };
}

function confirmTurnoCompleted({ barberId, turnoId }) {
  return turnosService.confirmarTurnoCompletado({
    id: Number(turnoId),
    barber_id: Number(barberId),
  });
}

function getBotStatus() {
  return { enabled: settingsRepo.getBoolean('bot_enabled', true) };
}

function updateBotStatus(enabled) {
  settingsRepo.setBoolean('bot_enabled', Boolean(enabled));
  return getBotStatus();
}

module.exports = {
  getSummary,
  getCalendar,
  getDay,
  createDayTurno,
  removeDayTurno,
  getBalance,
  updateBalanceGoal,
  confirmTurnoCompleted,
  getBotStatus,
  updateBotStatus,
};
