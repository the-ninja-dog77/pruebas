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
const AGENDA_HIDE_PAST_AFTER_MINUTES = Number(
  process.env.BARBER_PANEL_HIDE_PAST_AFTER_MINUTES || 60
);
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

function isAgendaItemVisible(turno, nowParts) {
  if (!turno?.fecha || !turno?.hora) return true;
  if (turno.fecha !== nowParts.fecha) return true;
  const diff = businessTime.diffMinutes(turno.fecha, turno.hora, nowParts);
  if (diff === null) return true;
  const minutesAfterStart = -diff;
  return minutesAfterStart < AGENDA_HIDE_PAST_AFTER_MINUTES;
}

function filterVisibleAgenda(agenda, nowParts) {
  const list = Array.isArray(agenda) ? agenda : [];
  return list.filter(turno => isAgendaItemVisible(turno, nowParts));
}

function groupAgendaByOrigen(agenda) {
  const groups = {
    panel: [],
    bot: [],
    other: [],
  };

  for (const turno of agenda || []) {
    const origen = String(turno?.origen || '').toLowerCase().trim();
    if (origen === 'panel') {
      groups.panel.push(turno);
      continue;
    }
    if (origen === 'bot') {
      groups.bot.push(turno);
      continue;
    }
    groups.other.push(turno);
  }

  return groups;
}

function pdfEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildSimplePdfFromOps(ops) {
  const objects = [];
  const addObject = value => {
    objects.push(String(value));
    return objects.length;
  };

  const content = ops.join('\n');
  const contentObj = addObject(
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`
  );
  const fontRegularObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageObj = addObject(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularObj} 0 R /F2 ${fontBoldObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
  );
  const pagesObj = addObject(`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`);
  const catalogObj = addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets = [0];
  let cursor = Buffer.byteLength(header, 'utf8');

  objects.forEach((obj, i) => {
    const index = i + 1;
    offsets[index] = cursor;
    const chunk = `${index} 0 obj\n${obj}\nendobj\n`;
    body += chunk;
    cursor += Buffer.byteLength(chunk, 'utf8');
  });

  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(header + body + xref + trailer, 'utf8');
}

function buildDaySummaryPdf({ barberId, fecha, agenda, extras, nowParts }) {
  const groups = groupAgendaByOrigen(agenda);
  const totalPanel = groups.panel.reduce((acc, t) => acc + Number(t.total || 0), 0);
  const totalBot = groups.bot.reduce((acc, t) => acc + Number(t.total || 0), 0);
  const totalOther = groups.other.reduce((acc, t) => acc + Number(t.total || 0), 0);
  const totalExtras = (extras || []).reduce((acc, e) => acc + Number(e.monto || 0), 0);
  const totalDia = totalPanel + totalBot + totalOther + totalExtras;

  const ops = [];
  const pushText = (x, y, size, text, bold = false) => {
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`);
  };
  const pushEntry = (y, text, kind = 'normal') => {
    if (kind === 'muted') ops.push('0.68 0.68 0.68 rg');
    else ops.push('1 1 1 rg');
    pushText(34, y, 10, text, false);
  };

  ops.push('0.05 0.05 0.05 rg');
  ops.push('0 0 595 842 re f');
  ops.push('1 0.88 0 rg');
  ops.push('0 774 595 68 re f');
  ops.push('0 0 0 rg');
  pushText(30, 812, 18, 'ZZETA Barber - Resumen Diario', true);
  pushText(30, 792, 10, `Barbero #${barberId}  |  Fecha: ${fecha}  |  TZ: ${nowParts.timezone}`);

  ops.push('1 1 1 rg');
  pushText(30, 758, 11, `Turnos por panel: ${groups.panel.length}  |  Total: ${totalPanel.toLocaleString('es-ES')}`);
  pushText(30, 742, 11, `Turnos por bot: ${groups.bot.length}  |  Total: ${totalBot.toLocaleString('es-ES')}`);
  pushText(30, 726, 11, `Turnos origen mixto/otro: ${groups.other.length}  |  Total: ${totalOther.toLocaleString('es-ES')}`);
  pushText(30, 710, 11, `Ingresos extra manuales: ${(extras || []).length}  |  Total: ${totalExtras.toLocaleString('es-ES')}`);
  ops.push('1 0.88 0 rg');
  pushText(30, 692, 12, `TOTAL DIA: ${totalDia.toLocaleString('es-ES')}`, true);

  let y = 668;
  const drawSection = (title, list) => {
    ops.push('1 0.88 0 rg');
    pushText(30, y, 11, title, true);
    y -= 14;
    if (!list.length) {
      pushEntry(y, 'Sin movimientos.', 'muted');
      y -= 14;
      return;
    }

    for (const item of list.slice(0, 16)) {
      const pago = item.metodo_pago ? ` | ${item.metodo_pago}` : '';
      const estado = Number(item.completado || 0) === 1 ? ' | Completado' : '';
      const line = `${item.hora} - ${item.servicio} - ${item.cliente} | ${Number(item.total || 0).toLocaleString('es-ES')}${pago}${estado}`;
      pushEntry(y, line);
      y -= 13;
      if (y < 72) break;
    }
    if (list.length > 16 && y >= 72) {
      pushEntry(y, `... y ${list.length - 16} mas`, 'muted');
      y -= 13;
    }
    y -= 8;
  };

  drawSection('Turnos cargados por barbero (panel)', groups.panel);
  if (y >= 72) drawSection('Turnos agendados por bot', groups.bot);
  if (y >= 72 && groups.other.length) drawSection('Turnos de otros origenes', groups.other);

  if (y >= 72) {
    ops.push('1 0.88 0 rg');
    pushText(30, y, 11, 'Ingresos extra manuales', true);
    y -= 14;
    if (!(extras || []).length) {
      pushEntry(y, 'Sin ingresos extra.', 'muted');
      y -= 14;
    } else {
      for (const entry of extras.slice(0, 10)) {
        const concept = entry.concepto || 'Venta adicional';
        pushEntry(
          y,
          `${entry.hora} - ${concept} | ${Number(entry.monto || 0).toLocaleString('es-ES')}`
        );
        y -= 13;
        if (y < 72) break;
      }
    }
  }

  ops.push('0.68 0.68 0.68 rg');
  pushText(30, 36, 9, `Generado: ${nowParts.fecha} ${nowParts.hora}`, false);
  pushText(430, 36, 9, 'ZZETA Panel', false);
  return buildSimplePdfFromOps(ops);
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

  const nowParts = nowLocalParts();
  const counts = barberPanelRepo.getMonthCounts({ barberId, month: selectedMonth }) || [];
  if (nowParts.fecha.startsWith(`${selectedMonth}-`)) {
    const agendaToday = barberPanelRepo.getTurnosByDay({ barberId, fecha: nowParts.fecha });
    const visibleToday = filterVisibleAgenda(agendaToday, nowParts);
    const todayCount = visibleToday.length;
    const existing = counts.find(item => item.fecha === nowParts.fecha);
    if (existing) {
      existing.cantidad = todayCount;
    } else if (todayCount > 0) {
      counts.push({ fecha: nowParts.fecha, cantidad: todayCount });
      counts.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    }
  }

  return {
    month: selectedMonth,
    counts,
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
  const nowParts = nowLocalParts();
  const visibleAgenda = filterVisibleAgenda(agenda, nowParts);
  const disponibles = turnosService.obtenerDisponibilidad(fecha, barberId).disponibles;
  const rule = businessHours.getRuleForDate(fecha);

  return {
    fecha,
    dayName: rule.dayName,
    businessHours: rule.label,
    agenda: visibleAgenda,
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
  const extras = barberPanelRepo.getManualIncomeByRange({
    barberId,
    fromDate: dateRange.from,
    toDate: dateRange.to,
  });
  const completados = rows.filter(r => Number(r.completado || 0) === 1);
  const serviceAmount = completados.reduce((acc, r) => acc + Number(r.total || 0), 0);
  const extraAmount = (extras || []).reduce((acc, e) => acc + Number(e.monto || 0), 0);
  const amount = serviceAmount + extraAmount;
  const goal = parseGoalValue(settingsRepo.getValue(getBalanceGoalKey(barberId)));
  const progress = goal > 0 ? Math.max(0, Math.min(100, (amount / goal) * 100)) : 0;

  return {
    range: dateRange.range,
    from: dateRange.from,
    to: dateRange.to,
    confirmedTurnos: completados.length,
    serviceAmount,
    extraAmount,
    extraEntries: (extras || []).length,
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

function addExtraIncome({ barberId, amount, concept, direction = 'add' }) {
  const nowParts = nowLocalParts();
  const amountBase = Math.round(Number(amount || 0));
  if (!Number.isFinite(amountBase) || amountBase <= 0) {
    const err = new Error('Monto invalido.');
    err.status = 400;
    throw err;
  }

  const normalizedDirection = String(direction || 'add').toLowerCase() === 'subtract'
    ? 'subtract'
    : 'add';

  const monto = normalizedDirection === 'subtract' ? -amountBase : amountBase;

  const concepto = String(concept || '').trim();
  if (!concepto || concepto.length < 2) {
    const err = new Error('Concepto invalido.');
    err.status = 400;
    throw err;
  }

  const record = barberPanelRepo.createManualIncome({
    barberId,
    fecha: nowParts.fecha,
    hora: nowParts.hora,
    monto,
    concepto: concepto.slice(0, 120),
    createdAt: new Date().toISOString(),
  });

  return {
    message:
      normalizedDirection === 'subtract' ?
        'Egreso registrado' :
        'Ingreso extra registrado',
    direction: normalizedDirection,
    record,
  };
}

function getTodaySummaryPdf(barberId, fecha = null) {
  const selectedFecha = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
    ? String(fecha)
    : nowLocalParts().fecha;
  const nowParts = nowLocalParts();
  const agenda = barberPanelRepo.getTurnosByDay({ barberId, fecha: selectedFecha }) || [];
  const extras = barberPanelRepo.getManualIncomeByDay({ barberId, fecha: selectedFecha }) || [];
  return buildDaySummaryPdf({
    barberId,
    fecha: selectedFecha,
    agenda,
    extras,
    nowParts,
  });
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
  addExtraIncome,
  getTodaySummaryPdf,
  confirmTurnoCompleted,
  getBotStatus,
  updateBotStatus,
};
