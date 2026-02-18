const turnosRepo = require('../repositories/turnos.repository');
const clientesRepo = require('../repositories/clientes.repository');

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
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

const SERVICE_PRICES = {
  'corte': 30000,
  'corte + barba': 45000,
  'barba': 20000,
  'perfilado de cejas': 15000,
  'cejas': 15000,
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
  if (key.includes('barba')) return SERVICE_PRICES['barba'];
  if (key.includes('ceja')) return SERVICE_PRICES['cejas'];

  return 30000;
}

function validarHorarioBot(hora) {
  const minutos = horaToMinutos(hora);
  const apertura = horaToMinutos('09:00');
  const cierre = horaToMinutos('20:00');

  if (minutos < apertura || minutos >= cierre) {
    return 'Fuera del horario laboral (09:00 a 20:00)';
  }

  const almuerzoInicio = horaToMinutos('12:00');
  const almuerzoFin = horaToMinutos('13:00');

  if (minutos >= almuerzoInicio && minutos < almuerzoFin) {
    return 'Horario de almuerzo (12:00 a 13:00)';
  }

  return null;
}

function obtenerDisponibilidad(fecha) {
  const apertura = horaToMinutos('09:00');
  const cierre = horaToMinutos('20:00');
  const almuerzoInicio = horaToMinutos('12:00');
  const almuerzoFin = horaToMinutos('13:00');

  const turnosDelDia = turnosRepo.getHorasByFecha(fecha);
  const disponibles = [];

  for (let min = apertura; min < cierre; min += 60) {
    if (min >= almuerzoInicio && min < almuerzoFin) continue;

    const conflicto = turnosDelDia.find(t => {
      const existenteMin = horaToMinutos(t.hora);
      return Math.abs(existenteMin - min) < 60;
    });

    if (!conflicto) {
      const h = String(Math.floor(min / 60)).padStart(2, '0');
      disponibles.push(`${h}:00`);
    }
  }

  return { fecha, disponibles };
}

function crearTurno(data) {
  if (data.origen === 'bot') {
    const errorHorario = validarHorarioBot(data.hora);
    if (errorHorario) {
      const error = new Error(errorHorario);
      error.status = 400;
      throw error;
    }

    const nuevaHoraMin = horaToMinutos(data.hora);
    const turnosDelDia = turnosRepo.getHorasByFecha(data.fecha);
    const conflicto = turnosDelDia.find(t => {
      return Math.abs(horaToMinutos(t.hora) - nuevaHoraMin) < 60;
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
  const total = precio;

  const nuevoTurno = turnosRepo.create({
    barber_id: data.barber_id,
    cliente_id: data.cliente_id,
    cliente: data.cliente,
    servicio: data.servicio,
    fecha: data.fecha,
    hora: data.hora,
    origen: data.origen || 'panel',
    precio,
    total,
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
  crearTurno,
  eliminarTurno,
  getRecordatorioActivo,
  responderRecordatorio,
  iniciarRecordatorios,
};
