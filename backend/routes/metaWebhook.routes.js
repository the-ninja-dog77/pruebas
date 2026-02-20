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

logger.info(
  `WHATSAPP config loaded graphVersion=${GRAPH_VERSION} botBarberId=${BOT_BARBER_ID} phoneNumberIdSet=${Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID
  )} tokenSet=${Boolean(process.env.WHATSAPP_TOKEN)} aiEnabled=${aiAssistant.isEnabled()}`
);

const sessions = new Map();
const START_INTENTS = ['turno', 'reserv', 'agend', 'cita'];
const GREETING_INTENTS = ['hola', 'buenas', 'buen dia', 'buenas tardes', 'buenas noches'];
const REASSURANCE_INTENTS = [
  'seguro',
  'segura',
  'de verdad',
  'en serio',
  'confirmame',
  'confirmar disponibilidad',
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
  if (msg.includes('barba') || msg.includes('afeitado')) return 'Barba';
  if (msg.includes('ceja')) return 'Perfilado de Cejas';
  if (msg.includes('corte') || msg.includes('pelo')) return 'Corte';
  return null;
}

function createEmptySession() {
  return {
    stage: 'idle',
    draft: {
      servicio: null,
      fecha: null,
      hora: null,
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
  const disponibles = turnosService.obtenerDisponibilidad(fecha, BOT_BARBER_ID).disponibles;
  return disponibles.includes(hora);
}

function applyDetections(session, msg) {
  const servicio = detectService(msg);
  if (servicio) session.draft.servicio = servicio;

  const fecha = parseDate(msg);
  if (fecha) session.draft.fecha = fecha;

  const hora = parseTime(msg);
  if (hora) session.draft.hora = hora;
}

function buildAvailabilityMessage(fecha) {
  const disponibilidad = turnosService.obtenerDisponibilidad(fecha, BOT_BARBER_ID).disponibles;
  if (!disponibilidad.length) {
    return `Para ${fecha} no quedan horarios disponibles.`;
  }

  const visible = disponibilidad.slice(0, 8).join(', ');
  const suffix = disponibilidad.length > 8 ? ', ...' : '';

  return `Horarios disponibles para ${fecha}: ${visible}${suffix}`;
}

function buildSummaryMessage(draft) {
  return `Te resumo: ${draft.servicio}, ${draft.fecha} a las ${draft.hora}. Si queres confirmar, responde "confirmar".`;
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

  if (containsAny(msg, ['cancelar', 'anular', 'salir', 'reiniciar'])) {
    resetSession(from);
    return 'Listo, cancele el flujo actual. Escribi "turno" para empezar otra reserva.';
  }

  if (containsAny(msg, ['ubicacion', 'donde', 'direccion', 'mapa'])) {
    return 'Estamos en ZZETA Barber Club. Mapa: https://www.google.com/maps/search/ZZETA%20BARBER%20CLUB/';
  }

  applyDetections(session, msg);

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

    const aiReply = await maybeAiFallback(texto, session);
    if (aiReply) return aiReply;

    return 'Puedo ayudarte a reservar. Escribi "turno" para empezar.';
  }

  if (session.stage === 'idle') {
    session.stage = 'collecting';
  }

  if (!session.draft.servicio) {
    session.stage = 'awaiting_service';
    return 'Perfecto. Que servicio queres? (Corte, Barba, Corte + Barba, Perfilado de Cejas)';
  }

  if (!session.draft.fecha) {
    session.stage = 'awaiting_date';
    return 'Genial. Para que fecha queres el turno? (ej: 2026-02-23 o 23/02/2026)';
  }

  if (!session.draft.hora) {
    session.stage = 'awaiting_time';
    return `${buildAvailabilityMessage(session.draft.fecha)} Decime la hora en formato HH:MM (ej: 15:00).`;
  }

  const disponibilidad = turnosService.obtenerDisponibilidad(
    session.draft.fecha,
    BOT_BARBER_ID
  ).disponibles;
  if (!disponibilidad.includes(session.draft.hora)) {
    session.stage = 'awaiting_time';
    return `Ese horario no esta disponible. ${buildAvailabilityMessage(session.draft.fecha)} Decime otra hora.`;
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
      cliente: `WhatsApp ${from}`,
      servicio: session.draft.servicio,
      fecha: session.draft.fecha,
      hora: session.draft.hora,
      origen: 'bot',
    });

    resetSession(from);
    return `Listo, turno confirmado para ${turno.fecha} a las ${turno.hora} (${turno.servicio}).`;
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
