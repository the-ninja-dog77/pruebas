const barberPanelRepo = require('../repositories/barberPanel.repository');
const settingsRepo = require('../repositories/settings.repository');
const clientesRepo = require('../repositories/clientes.repository');
const turnosService = require('./turnos.service');
const businessHours = require('./businessHours.service');

function pad2(v) {
  return String(v).padStart(2, '0');
}

function nowLocalParts() {
  const now = new Date();
  const fecha = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const hora = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return { fecha, hora };
}

function getSummary(barberId) {
  const { fecha, hora } = nowLocalParts();
  const summary = barberPanelRepo.getDaySummary({ barberId, fecha, hora }) || {};
  const nextTurno = barberPanelRepo.getNextTurno({ barberId, fecha, hora }) || null;

  return {
    fecha,
    totalTurnosHoy: Number(summary.totalTurnos || 0),
    atendidosHoy: Number(summary.atendidosHoy || 0),
    pendientesHoy: Number(summary.pendientesHoy || 0),
    ingresosHoy: Number(summary.ingresosHoy || 0),
    proximoTurno: nextTurno,
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
  getBotStatus,
  updateBotStatus,
};
