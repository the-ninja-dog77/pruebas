const turnosRepo = require('../repositories/turnos.repository');
const clientesRepo = require('../repositories/clientes.repository');
const businessHours = require('./businessHours.service');
const businessTime = require('./businessTime.service');

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

  const nuevoTurno = turnosRepo.create({
    barber_id: data.barber_id,
    cliente_id: data.cliente_id,
    cliente: data.cliente,
    servicio: data.servicio,
    fecha: data.fecha,
    hora: data.hora,
    origen: data.origen || 'panel',
    precio: precioFinal,
    total,
    metodo_pago: data.metodo_pago || null,
  });

  clientesRepo.updateEstado(data.cliente_id, 'confirmado');
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

  if (!user && turno.cliente_id !== cliente_id) {
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
  return turnosRepo.getRecordatorioActivoPorCliente(clienteId) || null;
}

function responderRecordatorio({ id, accion, cliente_id }) {
  const turno = turnosRepo.getById(id);
  if (!turno) {
    const error = new Error('Turno no encontrado');
    error.status = 404;
    throw error;
  }

  if (turno.cliente_id !== cliente_id) {
    const error = new Error('No podés responder un turno que no es tuyo');
    error.status = 403;
    throw error;
  }

  if (accion === 'confirmar') {
    turnosRepo.clearEsperandoRespuesta(id);
    clientesRepo.updateEstado(cliente_id, 'confirmado');
    return { message: 'Turno confirmado' };
  }

  if (accion === 'cancelar') {
    turnosRepo.remove(id);
    clientesRepo.updateEstado(cliente_id, 'cancelado');
    return { message: 'Turno cancelado' };
  }

  const error = new Error('Acción inválida');
  error.status = 400;
  throw error;
}

function iniciarRecordatorios(logger) {
  setInterval(() => {
    const ahora = new Date();
    const pendientes = turnosRepo.getPendientesRecordatorio();

    pendientes.forEach(turno => {
      const fechaHoraTurno = new Date(`${turno.fecha}T${turno.hora}:00`);
      const diffMin = Math.floor((fechaHoraTurno - ahora) / 60000);

      if (diffMin === 15) {
        turnosRepo.marcarRecordatorioEnviado(turno.id);
        logger.info(
          `RECORDATORIO AUTOMATICO turno=${turno.id} hora=${turno.hora} servicio=${turno.servicio}`
        );
      }
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
  crearTurno,
  eliminarTurno,
  getRecordatorioActivo,
  responderRecordatorio,
  iniciarRecordatorios,
};
