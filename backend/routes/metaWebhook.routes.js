const express = require('express');
const router = express.Router();
const logger = require('../logger');
const turnosService = require('../services/turnos.service');
const clientesRepo = require('../repositories/clientes.repository');
const settingsRepo = require('../repositories/settings.repository');
const aiAssistant = require('../services/aiAssistant.service');

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'zzeta_verify_token';
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const BOT_BARBER_ID = Number(process.env.BOT_BARBER_ID || 1);
const BOT_MIN_LEAD_MINUTES = Number(process.env.BOT_MIN_LEAD_MINUTES || 0);

logger.info(
  `WHATSAPP config loaded graphVersion=${GRAPH_VERSION} botBarberId=${BOT_BARBER_ID} botMinLead=${BOT_MIN_LEAD_MINUTES} phoneNumberIdSet=${Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID
  )} tokenSet=${Boolean(process.env.WHATSAPP_TOKEN)} aiEnabled=${aiAssistant.isEnabled()}`
);

const sessions = new Map();
const START_INTENTS = ['turno', 'reserv', 'agend', 'cita'];
const GREETING_INTENTS = ['hola', 'buenas', 'buen dia', 'buenas tardes', 'buenas noches'];
const THANKS_INTENTS = ['gracias', 'muchas gracias', 'te agradezco', 'thanks'];
const REASSURANCE_INTENTS = [
  'seguro',
  'segura',
  'de verdad',
  'en serio',
  'confirmame',
  'confirmar disponibilidad',
];
const MANAGE_CANCEL_INTENTS = [
  'cancelar turno',
  'anular turno',
  'eliminar turno',
  'borrar turno',
];
const MANAGE_RESCHEDULE_INTENTS = [
  'reprogramar turno',
  'cambiar turno',
  'mover turno',
  'pasar turno',
];

function normalizeText(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function containsAny(texto, needles) {
  return needles.some(needle => texto.includes(needle));
}

function normalizeIntentText(texto) {
  return String(texto || '')
    .replace(/[?!.,;:"'()¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isConfirmIntent(intentText) {
  const positives = ['confirmar', 'confirmo', 'ok', 'dale', 'de una', 'listo', 'perfecto'];
  if (positives.some(p => intentText.includes(p))) return true;

  return intentText === 'si' || intentText === 's';
}

function isNegativeConfirmIntent(intentText) {
  return (
    intentText === 'no' ||
    intentText.includes('no quiero') ||
    intentText.includes('no deseo') ||
    intentText.includes('todavia no')
  );
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateLocal(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function isValidDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function parseDate(msg) {
  let match = msg.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (isValidDate(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  match = msg.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const rawYear = match[3];
    let year = rawYear ? Number(rawYear) : new Date().getFullYear();

    if (rawYear && rawYear.length === 2) {
      year += 2000;
    }

    if (isValidDate(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  if (msg.includes('pasado manana')) return formatDateLocal(addDays(2));
  if (msg.includes('manana')) return formatDateLocal(addDays(1));
  if (msg.includes('hoy')) return formatDateLocal(new Date());

  const weekdayMap = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };

  for (const [name, targetDay] of Object.entries(weekdayMap)) {
    if (!msg.includes(name)) continue;

    const today = new Date();
    const todayDay = today.getDay();
    const diff = (targetDay - todayDay + 7) % 7 || 7;

    return formatDateLocal(addDays(diff));
  }

  return null;
}

function parseTime(msg) {
  let match = msg.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) {
    return `${pad2(Number(match[1]))}:${pad2(Number(match[2]))}`;
  }

  match = msg.match(/(?:a\s*las|alas|para\s*las|a\s*la)\s*([0-2]?\d)(?:\s*hs?)?\b/);
  if (!match) {
    match = msg.match(/\b([0-2]?\d)\s*hs\b/);
  }

  if (!match) return null;

  let hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  if (hour >= 0 && hour <= 8) {
    hour += 12;
  }

  return `${pad2(hour)}:00`;
}

function detectService(msg) {
  if (msg.includes('corte') && msg.includes('barba')) return 'Corte + Barba';
  if (msg.includes('barba') || msg.includes('afeitado')) return 'Recorte/Tratamiento de Barba';
  if (msg.includes('ceja')) return 'Perfilado de Cejas';
  if (msg.includes('corte') || msg.includes('pelo')) return 'Corte';
  return null;
}

function detectPaymentMethod(msg) {
  if (containsAny(msg, ['efectivo', 'cash'])) return 'Efectivo';
  if (containsAny(msg, ['transferencia', 'transfer', 'qr', 'billetera'])) {
    return 'Transferencia/QR';
  }
  if (containsAny(msg, ['tarjeta', 'debito', 'credito', 'pos'])) return 'Tarjeta';
  return null;
}

function parseClientName(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^(me llamo|soy|mi nombre es|a nombre de)\s+/i, '')
    .replace(/^(a|para)\s+/i, '')
    .replace(/\b(ya lo sabes|nms|nomas|bro+|rey)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 80) return null;
  const normalized = normalizeText(cleaned);
  if (detectPaymentMethod(normalized)) return null;
  if (containsAny(normalized, GREETING_INTENTS)) return null;
  if (containsAny(normalized, ['confirmar', 'cancelar', 'turno'])) return null;
  return cleaned;
}

function extractNameForManage(rawText) {
  let cleaned = String(rawText || '');
  cleaned = cleaned
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ')
    .replace(/\b([01]?\d|2[0-3])(?::[0-5]\d)?\b/g, ' ')
    .replace(
      /\b(cancelar|anular|eliminar|borrar|reprogramar|cambiar|mover|pasar|turno|de|del|para|el|la|las|hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a|las|al)\b/gi,
      ' '
    )
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return parseClientName(cleaned);
}

function createEmptySession() {
  return {
    stage: 'idle',
    draft: {
      servicio: null,
      fecha: null,
      hora: null,
      nombre: null,
      metodo_pago: null,
      explicitOtherPerson: false,
    },
    manage: {
      action: null,
      nombre: null,
      fecha: null,
      hora: null,
      turnoId: null,
      turnoOriginalFecha: null,
      turnoOriginalHora: null,
      nuevaFecha: null,
      nuevaHora: null,
    },
    lastAvailability: null,
  };
}

function getSession(from) {
  if (!sessions.has(from)) {
    sessions.set(from, createEmptySession());
  }

  return sessions.get(from);
}

function resetSession(from) {
  sessions.set(from, createEmptySession());
}

function getCurrentSlotAvailability(fecha, hora) {
  const disponibles = turnosService.obtenerDisponibilidad(fecha, BOT_BARBER_ID, {
    includePastForToday: false,
    minLeadMinutes: BOT_MIN_LEAD_MINUTES,
  }).disponibles;
  return disponibles.includes(hora);
}

function applyDetections(session, msg) {
  const servicio = detectService(msg);
  if (servicio) session.draft.servicio = servicio;

  const fecha = parseDate(msg);
  if (fecha) session.draft.fecha = fecha;

  const hora = parseTime(msg);
  if (hora) session.draft.hora = hora;

  const metodoPago = detectPaymentMethod(msg);
  if (metodoPago) session.draft.metodo_pago = metodoPago;

  if (containsAny(msg, ['a nombre de', 'es para', 'para otra persona'])) {
    session.draft.explicitOtherPerson = true;
  }
}

function buildAvailabilityMessage(fecha) {
  if (turnosService.esFechaPasada(fecha)) {
    return `La fecha ${fecha} ya paso. Decime una fecha igual o posterior a hoy.`;
  }

  const disponibilidad = turnosService.obtenerDisponibilidad(fecha, BOT_BARBER_ID, {
    includePastForToday: false,
    minLeadMinutes: BOT_MIN_LEAD_MINUTES,
  }).disponibles;
  if (!disponibilidad.length) {
    return `Para ${fecha} no quedan horarios disponibles.`;
  }

  const visible = disponibilidad.slice(0, 8).join(', ');
  const suffix = disponibilidad.length > 8 ? ', ...' : '';

  return `Horarios disponibles para ${fecha}: ${visible}${suffix}`;
}

function buildSummaryMessage(draft) {
  return `Te resumo: ${draft.nombre}, ${draft.servicio}, ${draft.fecha} a las ${draft.hora}, pago ${draft.metodo_pago}. Recorda que el pago se realiza despues del corte. Si queres confirmar, responde "confirmar".`;
}

function fillManageTargetDetections(manage, texto, msg) {
  if (!manage.nombre) {
    const nombre = extractNameForManage(texto);
    if (nombre) manage.nombre = nombre;
  }
  if (!manage.fecha) {
    const fecha = parseDate(msg);
    if (fecha) manage.fecha = fecha;
  }
  if (!manage.hora) {
    const hora = parseTime(msg);
    if (hora) manage.hora = hora;
  }
}

function fillManageNewDetections(manage, msg) {
  if (!manage.nuevaFecha) {
    const fecha = parseDate(msg);
    if (fecha) manage.nuevaFecha = fecha;
  }
  if (!manage.nuevaHora) {
    const hora = parseTime(msg);
    if (hora) manage.nuevaHora = hora;
  }
}

async function maybeAiFallback(texto, session) {
  if (!aiAssistant.isEnabled()) return null;
  if (!aiAssistant.isQuestionLike(texto)) return null;
  return aiAssistant.generateReply(texto, session);
}

async function buildReply(from, texto) {
  const msg = normalizeText(texto);
  const session = getSession(from);
  const intentText = normalizeIntentText(msg);

  if (!msg) {
    return 'Escribime que servicio, fecha y hora queres reservar.';
  }

  const wantsManageCancelCommand = containsAny(msg, MANAGE_CANCEL_INTENTS);
  const wantsManageRescheduleCommand = containsAny(msg, MANAGE_RESCHEDULE_INTENTS);

  if (wantsManageCancelCommand) {
    session.stage = 'manage_cancel_collect';
    session.manage = {
      action: 'cancel',
      nombre: null,
      fecha: null,
      hora: null,
      turnoId: null,
      turnoOriginalFecha: null,
      turnoOriginalHora: null,
      nuevaFecha: null,
      nuevaHora: null,
    };
  }

  if (wantsManageRescheduleCommand) {
    session.stage = 'manage_reschedule_collect_current';
    session.manage = {
      action: 'reschedule',
      nombre: null,
      fecha: null,
      hora: null,
      turnoId: null,
      turnoOriginalFecha: null,
      turnoOriginalHora: null,
      nuevaFecha: null,
      nuevaHora: null,
    };
  }

  if (
    !wantsManageCancelCommand &&
    !wantsManageRescheduleCommand &&
    containsAny(msg, ['cancelar', 'anular', 'salir', 'reiniciar'])
  ) {
    const wantsBookingCancel = containsAny(msg, [
      'cancelar',
      'anular',
      'no voy a poder',
      'no puedo ir',
      'no voy a ir',
      'no podre ir',
      'no podre asistir',
    ]);

    if (wantsBookingCancel) {
      try {
        const turno = turnosService.getProximoTurnoPorClienteId(from);
        if (turno) {
          turnosService.eliminarTurno({
            id: turno.id,
            cliente_id: from,
            user: null,
          });
          resetSession(from);
          return `Listo, cancele tu turno del ${turno.fecha} a las ${turno.hora} (${turno.servicio}).`;
        }
      } catch (err) {
        logger.error(`WHATSAPP quick cancel error: ${err.stack || err.message}`);
      }
    }

    resetSession(from);
    return 'Listo, cancele el flujo actual. Si queres cancelar un turno especifico, escribi: "cancelar turno de NOMBRE el YYYY-MM-DD".';
  }

  if (containsAny(msg, ['ubicacion', 'donde', 'direccion', 'mapa'])) {
    return 'Estamos en ZZETA Barber Club. Mapa: https://www.google.com/maps/search/ZZETA%20BARBER%20CLUB/';
  }

  applyDetections(session, msg);

  if (session.stage === 'awaiting_name') {
    const name = parseClientName(texto);
    if (name) {
      session.draft.nombre = name;
    } else if (!session.draft.nombre) {
      return 'Necesito un nombre valido para agendar. Ejemplo: Juan Perez.';
    }
  }

  if (session.stage === 'manage_cancel_collect') {
    fillManageTargetDetections(session.manage, texto, msg);

    if (!session.manage.nombre || !session.manage.fecha) {
      return 'Para cancelar, decime nombre y fecha del turno (ej: Fernando Vallejos, 2026-02-24).';
    }

    try {
      const turno = turnosService.cancelarTurnoBot({
        barber_id: BOT_BARBER_ID,
        nombre: session.manage.nombre,
        fecha: session.manage.fecha,
        hora: session.manage.hora || null,
      });
      resetSession(from);
      return `Listo, cancele el turno de ${turno.cliente} del ${turno.fecha} a las ${turno.hora}.`;
    } catch (err) {
      if (err.status === 409 && Array.isArray(err.horas) && err.horas.length) {
        return `${err.message} Horas encontradas: ${err.horas.join(', ')}.`;
      }
      if (err.status === 404) {
        return 'No encontre ese turno. Verifica nombre, fecha y hora.';
      }

      logger.error(`WHATSAPP cancel booking error: ${err.stack || err.message}`);
      return 'No pude cancelar el turno ahora. Proba de nuevo en unos minutos.';
    }
  }

  if (session.stage === 'manage_reschedule_collect_current') {
    fillManageTargetDetections(session.manage, texto, msg);

    if (!session.manage.nombre || !session.manage.fecha) {
      return 'Para reprogramar, decime nombre y fecha del turno actual (ej: Fernando Vallejos, 2026-02-24).';
    }

    try {
      const turno = turnosService.resolverTurnoPorNombreFechaHora({
        barber_id: BOT_BARBER_ID,
        nombre: session.manage.nombre,
        fecha: session.manage.fecha,
        hora: session.manage.hora || null,
      });

      session.manage.turnoId = turno.id;
      session.manage.turnoOriginalFecha = turno.fecha;
      session.manage.turnoOriginalHora = turno.hora;
      session.stage = 'manage_reschedule_collect_new';

      return `Encontre el turno de ${turno.cliente} (${turno.fecha} ${turno.hora}). Decime la nueva fecha y hora (ej: 2026-02-25 16:00).`;
    } catch (err) {
      if (err.status === 409 && Array.isArray(err.horas) && err.horas.length) {
        return `${err.message} Horas encontradas: ${err.horas.join(', ')}.`;
      }
      if (err.status === 404) {
        return 'No encontre ese turno para reprogramar. Verifica nombre, fecha y hora.';
      }

      logger.error(`WHATSAPP reschedule resolve error: ${err.stack || err.message}`);
      return 'No pude preparar la reprogramacion ahora. Proba de nuevo en unos minutos.';
    }
  }

  if (session.stage === 'manage_reschedule_collect_new') {
    fillManageNewDetections(session.manage, msg);

    if (!session.manage.nuevaFecha || !session.manage.nuevaHora) {
      return 'Decime la nueva fecha y la nueva hora (ej: 2026-02-25 16:00).';
    }

    try {
      const turno = turnosService.reprogramarTurnoBot({
        id: session.manage.turnoId,
        barber_id: BOT_BARBER_ID,
        nuevaFecha: session.manage.nuevaFecha,
        nuevaHora: session.manage.nuevaHora,
      });

      const oldFecha = session.manage.turnoOriginalFecha;
      const oldHora = session.manage.turnoOriginalHora;
      resetSession(from);
      return `Listo, reprogramado: ${turno.cliente} paso de ${oldFecha} ${oldHora} a ${turno.fecha} ${turno.hora}.`;
    } catch (err) {
      if (err.status === 400 || err.status === 409) {
        session.manage.nuevaHora = null;
        return `${err.message}. ${buildAvailabilityMessage(session.manage.nuevaFecha)} Decime otra hora.`;
      }

      logger.error(`WHATSAPP reschedule booking error: ${err.stack || err.message}`);
      return 'No pude reprogramar el turno ahora. Proba de nuevo en unos minutos.';
    }
  }

  const wantsStart = containsAny(msg, START_INTENTS);
  const asksAvailability = containsAny(msg, [
    'horario',
    'horarios',
    'disponible',
    'disponibilidad',
    'turnos libres',
  ]);
  const asksTurnoAtSlot = containsAny(msg, [
    'hay turno',
    'hay un turno',
    'algun turno',
    'tienes algun turno',
    'tenes algun turno',
    'tenes turno',
    'tenes un turno',
    'tienes turno',
    'tienes un turno',
  ]);
  const confirms = isConfirmIntent(intentText);
  const rejectsConfirmation = isNegativeConfirmIntent(intentText);

  if (asksAvailability || asksTurnoAtSlot) {
    session.stage = 'collecting';
    if (!session.draft.fecha) {
      return 'Decime la fecha para revisar horarios (ej: 2026-02-23 o 23/02/2026).';
    }

    if (session.draft.hora) {
      const isAvailable = getCurrentSlotAvailability(session.draft.fecha, session.draft.hora);
      session.lastAvailability = {
        fecha: session.draft.fecha,
        hora: session.draft.hora,
        available: isAvailable,
      };

      if (isAvailable) {
        return `Si, ${session.draft.fecha} a las ${session.draft.hora} esta disponible. Si queres reservar, decime el servicio.`;
      }
      return `No, ${session.draft.fecha} a las ${session.draft.hora} no esta disponible. ${buildAvailabilityMessage(
        session.draft.fecha
      )}`;
    }

    return buildAvailabilityMessage(session.draft.fecha);
  }

  if (
    session.draft.fecha &&
    session.draft.hora &&
    !session.draft.servicio &&
    containsAny(msg, REASSURANCE_INTENTS)
  ) {
    const isAvailable = getCurrentSlotAvailability(session.draft.fecha, session.draft.hora);
    session.lastAvailability = {
      fecha: session.draft.fecha,
      hora: session.draft.hora,
      available: isAvailable,
    };

    if (isAvailable) {
      return `Si, ${session.draft.fecha} a las ${session.draft.hora} sigue disponible. Si queres reservar, decime el servicio.`;
    }

    return `No, ${session.draft.fecha} a las ${session.draft.hora} ya no esta disponible. ${buildAvailabilityMessage(
      session.draft.fecha
    )}`;
  }

  if (
    session.draft.fecha &&
    session.draft.hora &&
    !session.draft.servicio &&
    !wantsStart &&
    containsAny(msg, GREETING_INTENTS)
  ) {
    const isAvailable = getCurrentSlotAvailability(session.draft.fecha, session.draft.hora);
    session.lastAvailability = {
      fecha: session.draft.fecha,
      hora: session.draft.hora,
      available: isAvailable,
    };

    if (isAvailable) {
      return `Hola! ${session.draft.fecha} a las ${session.draft.hora} sigue disponible. Si queres reservar, decime el servicio.`;
    }

    return `Hola! ${session.draft.fecha} a las ${session.draft.hora} ya no esta disponible. ${buildAvailabilityMessage(
      session.draft.fecha
    )}`;
  }

  if (
    session.stage === 'idle' &&
    !wantsStart &&
    !session.draft.servicio &&
    !session.draft.fecha &&
    !session.draft.hora
  ) {
    if (
      containsAny(msg, GREETING_INTENTS)
    ) {
      return 'Hola! Soy ZZETA Bot. Si queres reservar, escribi "turno".';
    }

    if (containsAny(msg, THANKS_INTENTS)) {
      return 'De nada. Cuando quieras, estoy para ayudarte.';
    }

    const aiReply = await maybeAiFallback(texto, session);
    if (aiReply) return aiReply;

    return 'Puedo ayudarte a reservar. Escribi "turno" para empezar.';
  }

  if (session.stage === 'idle') {
    session.stage = 'collecting';
  }

  if (!session.draft.servicio) {
    session.stage = 'awaiting_service';
    return 'Perfecto. Que servicio queres? (corte, recorte/tratamiento de barba, perfilado de cejas)';
  }

  if (!session.draft.fecha) {
    session.stage = 'awaiting_date';
    return 'Genial. Para que fecha queres el turno? (ej: 2026-02-23 o 23/02/2026)';
  }

  if (turnosService.esFechaPasada(session.draft.fecha)) {
    session.draft.fecha = null;
    session.draft.hora = null;
    session.stage = 'awaiting_date';
    return 'Esa fecha ya paso. Decime una fecha igual o posterior a hoy (ej: 2026-02-23).';
  }

  if (!session.draft.hora) {
    session.stage = 'awaiting_time';
    return `${buildAvailabilityMessage(session.draft.fecha)} Decime la hora en formato HH:MM (ej: 15:00).`;
  }

  const disponibilidad = turnosService.obtenerDisponibilidad(
    session.draft.fecha,
    BOT_BARBER_ID,
    { includePastForToday: false, minLeadMinutes: BOT_MIN_LEAD_MINUTES }
  ).disponibles;
  if (!disponibilidad.includes(session.draft.hora)) {
    session.stage = 'awaiting_time';
    return `Ese horario no esta disponible. ${buildAvailabilityMessage(session.draft.fecha)} Decime otra hora.`;
  }

  if (!session.draft.nombre) {
    session.stage = 'awaiting_name';
    return 'Perfecto. A nombre de quien agendo el turno?';
  }

  const turnosActivosDelNumero = turnosService.getTurnosFuturosPorClienteId(from);
  if (turnosActivosDelNumero.length && !session.draft.explicitOtherPerson) {
    const yaAgendado = turnosActivosDelNumero[0];
    session.stage = 'awaiting_name';
    return `Ya tenes un turno activo el ${yaAgendado.fecha} a las ${yaAgendado.hora} (${yaAgendado.servicio}). Si queres cambiarlo, escribi "reprogramar turno". Si queres cancelarlo, escribi "cancelar". Si este nuevo turno es para otra persona, responde: "a nombre de Nombre Apellido".`;
  }

  if (!session.draft.metodo_pago) {
    session.stage = 'awaiting_payment';
    return 'Que metodo de pago preferis? (efectivo, transferencia/QR, tarjeta). Recorda que el pago se realiza despues del corte.';
  }

  if (session.stage !== 'awaiting_confirm') {
    session.stage = 'awaiting_confirm';
    return buildSummaryMessage(session.draft);
  }

  if (rejectsConfirmation) {
    return `${buildSummaryMessage(session.draft)} No se confirmo todavia. Si queres cancelar, escribi "cancelar".`;
  }

  if (!confirms) {
    const aiReply = await maybeAiFallback(texto, session);
    if (aiReply) {
      return `${aiReply} Si queres confirmar, responde "confirmar".`;
    }

    return `${buildSummaryMessage(session.draft)} Si queres cambiar algo, escribime el nuevo dato.`;
  }

  try {
    clientesRepo.ensureExists(from, `WhatsApp ${from}`);

    const turno = turnosService.crearTurno({
      barber_id: BOT_BARBER_ID,
      cliente_id: from,
      cliente: session.draft.nombre,
      servicio: session.draft.servicio,
      fecha: session.draft.fecha,
      hora: session.draft.hora,
      origen: 'bot',
      metodo_pago: session.draft.metodo_pago,
    });

    resetSession(from);
    return `Listo ${turno.cliente}, turno confirmado para ${turno.fecha} a las ${turno.hora} (${turno.servicio}). Pago: ${turno.metodo_pago}. Recorda que abonas despues del corte.`;
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      session.stage = 'awaiting_time';
      session.draft.hora = null;
      return `${err.message}. ${buildAvailabilityMessage(session.draft.fecha)} Decime otra hora.`;
    }

    logger.error(`WHATSAPP booking error: ${err.stack || err.message}`);
    return 'No pude crear el turno ahora. Proba de nuevo en unos minutos.';
  }
}

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/', async (req, res) => {
  try {
    const debugMode = req.headers['x-webhook-debug'] === '1';
    const botEnabled = settingsRepo.getBoolean('bot_enabled', true);

    if (!botEnabled) {
      logger.info('WHATSAPP bot disabled, inbound ignored');
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'bot_disabled' });
      }
      return res.sendStatus(200);
    }

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const incoming = value?.messages?.[0];

    // Always return 200 to avoid Meta retry loops.
    if (!incoming) {
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'no_message_event' });
      }
      return res.sendStatus(200);
    }

    const from = incoming.from;
    const texto =
      incoming.text?.body ||
      incoming.button?.text ||
      incoming.interactive?.button_reply?.title ||
      '';
    logger.info(`WHATSAPP inbound from=${from} text="${texto}"`);

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !accessToken) {
      const msg =
        'WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_TOKEN no configurados; no se puede responder.';
      logger.error(msg);
      if (debugMode) {
        return res.status(500).json({
          ok: false,
          error: msg,
          phoneNumberIdSet: Boolean(phoneNumberId),
          tokenSet: Boolean(accessToken),
          graphVersion: GRAPH_VERSION,
        });
      }
      return res.sendStatus(200);
    }

    const body = {
      messaging_product: 'whatsapp',
      to: from,
      type: 'text',
      text: { body: await buildReply(from, texto) },
    };

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`WHATSAPP send failed status=${response.status} body=${errText}`);
      if (debugMode) {
        return res.status(response.status).json({
          ok: false,
          graphStatus: response.status,
          graphBody: errText,
        });
      }
      return res.sendStatus(200);
    }

    const data = await response.json();
    logger.info(`WHATSAPP outbound ok messageId=${data.messages?.[0]?.id || 'n/a'}`);
    if (debugMode) {
      return res.status(200).json({ ok: true, outbound: data });
    }
    return res.sendStatus(200);
  } catch (err) {
    logger.error(`WHATSAPP webhook error: ${err.stack || err.message}`);
    if (req.headers['x-webhook-debug'] === '1') {
      return res.status(500).json({ ok: false, error: err.message });
    }
    return res.sendStatus(200);
  }
});

module.exports = router;
