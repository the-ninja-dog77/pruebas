const turnosRepo = require('../repositories/turnos.repository');
const clientesRepo = require('../repositories/clientes.repository');
const businessHours = require('./businessHours.service');
const businessTime = require('./businessTime.service');
const whatsappSender = require('./whatsappSender.service');

const TURNO_CLIENT_REMINDER_MINUTES = Number(
  process.env.TURNO_CLIENT_REMINDER_MINUTES || 15
);

function obtenerTodos(user) {
  if (user.role === 'admin') {
    return turnosRepo.getAll();
  }

  return turnosRepo.getAllByBarberId(user.barber_id);
}

function obtenerPorFecha(fecha, barberId, user) {
  if (user.role === 'admin' && !barberId) {
    return turnosRepo.getByFecha(fecha);
  }

  const barberIdObjetivo = barberId ? Number(barberId) : user.barber_id;

  if (
    user.role !== 'admin' &&
    user.barber_id !== Number(barberIdObjetivo)
  ) {
    const error = new Error('No podés ver turnos de otro barbero');
    error.status = 403;
    throw error;
  }

  return turnosRepo.getByFecha(fecha, barberIdObjetivo);
}

function horaToMinutos(hora) {
  return businessHours.horaToMinutos(hora);
}

function normalizeClientId(clienteId) {
  return String(clienteId || '').replace(/[^\d]/g, '').trim();
}

function buildClientIdVariants(clienteId) {
  const raw = String(clienteId || '').trim();
  const normalized = normalizeClientId(raw);
  const variants = [raw];

  if (normalized) {
    variants.push(normalized);
    variants.push(`+${normalized}`);
  }

  return Array.from(new Set(variants.filter(Boolean)));
}

const SERVICE_PRICES = {
  'corte': 40000,
  'recorte/tratamiento de barba': 10000,
  'perfilado de cejas': 10000,
  'corte + barba': 50000,
};

function inferPrecioServicio(servicio) {
  const key = String(servicio || '').trim().toLowerCase();
  if (SERVICE_PRICES[key] !== undefined) {
    return SERVICE_PRICES[key];
  }

  if (key.includes('corte') && key.includes('barba')) {
    return SERVICE_PRICES['corte + barba'];
  }
  if (key.includes('corte')) return SERVICE_PRICES['corte'];
  if (key.includes('barba') || key.includes('afeitado')) {
    return SERVICE_PRICES['recorte/tratamiento de barba'];
  }
  if (key.includes('ceja')) return SERVICE_PRICES['perfilado de cejas'];

  return SERVICE_PRICES['corte'];
}

function validarHorarioBot(hora, fecha) {
  const slots = businessHours.getSlotsForDate(fecha);
  if (!slots.length) {
    return 'Dia cerrado';
  }

  if (!slots.includes(hora)) {
    const rule = businessHours.getRuleForDate(fecha);
    return `Fuera del horario laboral (${rule.label})`;
  }

  return null;
}

function obtenerDisponibilidad(fecha, barberId = null, options = {}) {
  const includePastForToday = options.includePastForToday !== false;
  const minLeadMinutes = Number(options.minLeadMinutes || 0);
  const turnosDelDia = barberId
    ? turnosRepo.getHorasByFechaAndBarber(fecha, barberId)
    : turnosRepo.getHorasByFecha(fecha);
  const slots = businessHours.getSlotsForDate(fecha);
  const disponibles = [];

  for (const hora of slots) {
    const slotMin = horaToMinutos(hora);
    const conflicto = turnosDelDia.find(t => {
      const existenteMin = horaToMinutos(t.hora);
      return Math.abs(existenteMin - slotMin) < businessHours.SLOT_MINUTES;
    });

    if (!conflicto) {
      disponibles.push(hora);
    }
  }

  const finalDisponibles = includePastForToday
    ? disponibles
    : businessTime.keepCurrentAndFutureSlots(
      fecha,
      disponibles,
      horaToMinutos,
      minLeadMinutes
    );

  return { fecha, disponibles: finalDisponibles };
}

function normalizeComparable(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolverTurnoPorNombreFechaHora({ barber_id, nombre, fecha, hora = null }) {
  const targetName = normalizeComparable(nombre);
  const turnosDelDia = turnosRepo.getByFecha(fecha, barber_id);
  const candidatos = turnosDelDia.filter(
    t => normalizeComparable(t.cliente) === targetName
  );

  if (!candidatos.length) {
    const error = new Error('No encontre turnos con ese nombre y fecha');
    error.status = 404;
    throw error;
  }

  if (hora) {
    const exacto = candidatos.find(t => t.hora === hora);
    if (!exacto) {
      const error = new Error(
        `No encontre turno para ${nombre} el ${fecha} a las ${hora}`
      );
      error.status = 404;
      throw error;
    }
    return exacto;
  }

  if (candidatos.length > 1) {
    const error = new Error('Hay mas de un turno. Decime tambien la hora.');
    error.status = 409;
    error.horas = candidatos.map(t => t.hora);
    throw error;
  }

  return candidatos[0];
}

function cancelarTurnoBot({ barber_id, nombre, fecha, hora = null }) {
  const turno = resolverTurnoPorNombreFechaHora({
    barber_id,
    nombre,
    fecha,
    hora,
  });

  turnosRepo.remove(turno.id);
  if (turno.cliente_id) {
    clientesRepo.updateEstado(turno.cliente_id, 'cancelado');
  }

  return turno;
}

function reprogramarTurnoBot({ id, barber_id, nuevaFecha, nuevaHora }) {
  const turno = turnosRepo.getById(id);
  if (!turno || Number(turno.barber_id) !== Number(barber_id)) {
    const error = new Error('Turno no encontrado');
    error.status = 404;
    throw error;
  }

  if (businessTime.isPastDateTime(nuevaFecha, nuevaHora, horaToMinutos)) {
    const error = new Error('No puedo mover un turno a una fecha u horario pasado');
    error.status = 400;
    throw error;
  }

  const errorHorario = validarHorarioBot(nuevaHora, nuevaFecha);
  if (errorHorario) {
    const error = new Error(errorHorario);
    error.status = 400;
    throw error;
  }

  const nuevaHoraMin = horaToMinutos(nuevaHora);
  const turnosDelDia = turnosRepo
    .getByFecha(nuevaFecha, barber_id)
    .filter(t => t.id !== turno.id);
  const conflicto = turnosDelDia.find(t => {
    return Math.abs(horaToMinutos(t.hora) - nuevaHoraMin) < businessHours.SLOT_MINUTES;
  });

  if (conflicto) {
    const error = new Error(`Horario ocupado cerca de ${conflicto.hora}`);
    error.status = 409;
    throw error;
  }

  turnosRepo.updateFechaHora(turno.id, nuevaFecha, nuevaHora);
  return turnosRepo.getById(turno.id);
}

function getProximoTurnoPorClienteId(clienteId) {
  const variants = buildClientIdVariants(clienteId);
  const turnos = clientesRepo.getTurnosByClienteIds(variants) || [];
  if (!turnos.length) return null;

  const now = businessTime.getNowParts();
  const futuros = turnos
    .filter(t => {
      if (!t.fecha || !t.hora) return false;
      return t.fecha > now.fecha || (t.fecha === now.fecha && t.hora >= now.hora);
    })
    .sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
      return String(a.hora).localeCompare(String(b.hora));
    });

  return futuros[0] || null;
}

function getTurnosFuturosPorClienteId(clienteId) {
  const variants = buildClientIdVariants(clienteId);
  const turnos = clientesRepo.getTurnosByClienteIds(variants) || [];
  if (!turnos.length) return [];

  const now = businessTime.getNowParts();
  return turnos
    .filter(t => {
      if (!t.fecha || !t.hora) return false;
      return t.fecha > now.fecha || (t.fecha === now.fecha && t.hora >= now.hora);
    })
    .sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
      return String(a.hora).localeCompare(String(b.hora));
    });
}

function crearTurno(data) {
  if (data.origen === 'bot') {
    const minLeadMinutes = Number(process.env.BOT_MIN_LEAD_MINUTES || 0);

    if (businessTime.isPastDateTime(data.fecha, data.hora, horaToMinutos)) {
      const error = new Error('No puedo agendar turnos en fecha u horario pasado');
      error.status = 400;
      throw error;
    }

    if (
      businessTime.isTooSoonDateTime(
        data.fecha,
        data.hora,
        horaToMinutos,
        minLeadMinutes
      )
    ) {
      const error = new Error(
        `Ese horario requiere al menos ${minLeadMinutes} minutos de anticipacion`
      );
      error.status = 400;
      throw error;
    }

    const errorHorario = validarHorarioBot(data.hora, data.fecha);
    if (errorHorario) {
      const error = new Error(errorHorario);
      error.status = 400;
      throw error;
    }

    const nuevaHoraMin = horaToMinutos(data.hora);
    const turnosDelDia = data.barber_id
      ? turnosRepo.getHorasByFechaAndBarber(data.fecha, data.barber_id)
      : turnosRepo.getHorasByFecha(data.fecha);
    const conflicto = turnosDelDia.find(t => {
      return (
        Math.abs(horaToMinutos(t.hora) - nuevaHoraMin) < businessHours.SLOT_MINUTES
      );
    });

    if (conflicto) {
      const error = new Error(`Horario ocupado cerca de ${conflicto.hora}`);
      error.status = 409;
      throw error;
    }
  }

  const precio = data.precio !== undefined
    ? Number(data.precio)
    : inferPrecioServicio(data.servicio);
  const precioMinimo = inferPrecioServicio(data.servicio);
  const precioFinal = Number.isFinite(precio) ? Math.max(precio, precioMinimo) : precioMinimo;
  const total = precioFinal;
  const rawClienteId = String(data.cliente_id || '').trim();
  const normalizedClienteId = normalizeClientId(rawClienteId);
  const clienteIdFinal = /^\+?\d{8,15}$/.test(rawClienteId)
    ? normalizedClienteId
    : rawClienteId;

  const nuevoTurno = turnosRepo.create({
    barber_id: data.barber_id,
    cliente_id: clienteIdFinal,
    cliente: data.cliente,
    servicio: data.servicio,
    fecha: data.fecha,
    hora: data.hora,
    origen: data.origen || 'panel',
    precio: precioFinal,
    total,
    metodo_pago: data.metodo_pago || null,
  });

  if (clienteIdFinal) {
    clientesRepo.updateEstado(clienteIdFinal, 'confirmado');
  }
  return nuevoTurno;
}

function eliminarTurno({ id, cliente_id, user }) {
  const turno = turnosRepo.getById(id);

  if (!turno) {
    const error = new Error('Turno no encontrado');
    error.status = 404;
    throw error;
  }

  if (
    user &&
    user.role !== 'admin' &&
    user.barber_id !== turno.barber_id
  ) {
    const error = new Error('No podés modificar turnos de otro barbero');
    error.status = 403;
    throw error;
  }

  const canModify = user
    ? true
    : buildClientIdVariants(cliente_id).includes(String(turno.cliente_id || '').trim());
  if (!canModify) {
    const error = new Error('No podés modificar un turno que no es tuyo');
    error.status = 403;
    throw error;
  }

  turnosRepo.remove(id);

  const clienteIdObjetivo = turno.cliente_id || cliente_id;
  if (clienteIdObjetivo) {
    clientesRepo.updateEstado(clienteIdObjetivo, 'cancelado');
  }

  return { message: 'Turno eliminado' };
}

function getRecordatorioActivo(clienteId) {
  const variants = buildClientIdVariants(clienteId);
  return turnosRepo.getRecordatorioActivoPorClientes(variants) || null;
}

function responderRecordatorio({ id, accion, cliente_id }) {
  const turno = turnosRepo.getById(id);
  if (!turno) {
    const error = new Error('Turno no encontrado');
    error.status = 404;
    throw error;
  }

  const variants = buildClientIdVariants(cliente_id);
  const belongsToClient = variants.includes(String(turno.cliente_id || '').trim());
  if (!belongsToClient) {
    const error = new Error('No podés responder un turno que no es tuyo');
    error.status = 403;
    throw error;
  }

  const ownerClienteId = String(turno.cliente_id || '').trim();

  if (accion === 'confirmar') {
    turnosRepo.clearEsperandoRespuesta(id);
    if (ownerClienteId) {
      clientesRepo.updateEstado(ownerClienteId, 'confirmado');
    }
    return { message: 'Turno confirmado' };
  }

  if (accion === 'cancelar') {
    turnosRepo.remove(id);
    if (ownerClienteId) {
      clientesRepo.updateEstado(ownerClienteId, 'cancelado');
    }
    return { message: 'Turno cancelado' };
  }

  const error = new Error('Acción inválida');
  error.status = 400;
  throw error;
}

function confirmarTurnoCompletado({ id, barber_id }) {
  const turno = turnosRepo.getById(id);
  if (!turno || Number(turno.barber_id) !== Number(barber_id)) {
    const error = new Error('Turno no encontrado');
    error.status = 404;
    throw error;
  }

  if (Number(turno.completado || 0) === 1) {
    return turno;
  }

  turnosRepo.marcarCompletado(id);
  return turnosRepo.getById(id);
}

function shouldSendReminder(turno, ahora) {
  if (!turno || Number(turno.recordatorioEnviado || 0) === 1) return false;
  if (!turno.fecha || !turno.hora) return false;
  const fechaHoraTurno = new Date(`${turno.fecha}T${turno.hora}:00`);
  if (!Number.isFinite(fechaHoraTurno.getTime())) return false;

  const diffMin = Math.floor((fechaHoraTurno - ahora) / 60000);
  return diffMin <= TURNO_CLIENT_REMINDER_MINUTES && diffMin >= 0;
}

function getDiffMinutesToTurno(turno, ahora) {
  if (!turno?.fecha || !turno?.hora) return null;
  const fechaHoraTurno = new Date(`${turno.fecha}T${turno.hora}:00`);
  if (!Number.isFinite(fechaHoraTurno.getTime())) return null;
  return Math.floor((fechaHoraTurno - ahora) / 60000);
}

function isWhatsappClientId(clienteId) {
  const normalized = normalizeClientId(clienteId);
  if (!normalized) return false;
  return /^[0-9]{8,15}$/.test(normalized);
}

function buildClientReminderText(turno) {
  return `Recordatorio ZZETA: tu turno de ${turno.servicio} es hoy ${turno.fecha} a las ${turno.hora}. Responde 1 (si voy) para mantenerlo o 2 (no voy/cancelar) para liberarlo y evitar demoras.`;
}

function iniciarRecordatorios(logger) {
  setInterval(() => {
    const ahora = new Date();
    const pendientes = turnosRepo.getPendientesRecordatorio();

    pendientes.forEach(async turno => {
      const diffMin = getDiffMinutesToTurno(turno, ahora);
      if (diffMin === null) return;
      if (diffMin < 0) {
        turnosRepo.marcarRecordatorioEnviado(turno.id, { esperandoRespuesta: false });
        return;
      }
      if (!shouldSendReminder(turno, ahora)) return;

      const recipient = String(turno.cliente_id || '').trim();
      const canReply = isWhatsappClientId(recipient);
      if (!canReply) {
        turnosRepo.marcarRecordatorioEnviado(turno.id, { esperandoRespuesta: false });
        return;
      }

      const outbound = await whatsappSender.sendSafe(
        recipient,
        buildClientReminderText(turno),
        { kind: 'client_reminder', turnoId: turno.id }
      );

      if (!outbound.ok) return;

      turnosRepo.marcarRecordatorioEnviado(turno.id, { esperandoRespuesta: true });
      logger.info(
        `RECORDATORIO AUTOMATICO turno=${turno.id} cliente=${recipient} hora=${turno.hora} servicio=${turno.servicio} diffMin=${diffMin}`
      );
    });
  }, 60 * 1000);
}

module.exports = {
  obtenerTodos,
  obtenerPorFecha,
  obtenerDisponibilidad,
  esFechaPasada: businessTime.isPastDate,
  esFechaHoraPasada: (fecha, hora) => businessTime.isPastDateTime(fecha, hora, horaToMinutos),
  resolverTurnoPorNombreFechaHora,
  cancelarTurnoBot,
  reprogramarTurnoBot,
  getProximoTurnoPorClienteId,
  getTurnosFuturosPorClienteId,
  crearTurno,
  eliminarTurno,
  getRecordatorioActivo,
  responderRecordatorio,
  confirmarTurnoCompletado,
  iniciarRecordatorios,
};
