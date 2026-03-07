const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../logger');
const turnosService = require('../services/turnos.service');
const clientesRepo = require('../repositories/clientes.repository');
const settingsRepo = require('../repositories/settings.repository');
const aiAssistant = require('../services/aiAssistant.service');
const audioPipeline = require('../services/audioPipeline.service');
const audioMetrics = require('../services/audioObservability.service');
const reminderIntentService = require('../services/reminderIntent.service');
const whatsappSender = require('../services/whatsappSender.service');
const businessTime = require('../services/businessTime.service');

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'zzeta_verify_token';
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const WHATSAPP_PROVIDER =
  String(process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase() === 'gupshup'
    ? 'gupshup'
    : 'meta';
const GUPSHUP_API_KEY = String(process.env.GUPSHUP_API_KEY || '').trim();
const GUPSHUP_SOURCE = String(process.env.GUPSHUP_SOURCE || '').trim();
const BOT_BARBER_ID = Number(process.env.BOT_BARBER_ID || 1);
const BOT_MIN_LEAD_MINUTES = Number(process.env.BOT_MIN_LEAD_MINUTES || 0);
const COMPACT_BOOKING_MODE =
  String(process.env.WHATSAPP_COMPACT_MODE || 'false').toLowerCase() === 'true';
const SESSION_TTL_MS = Number(process.env.WHATSAPP_SESSION_TTL_MS || 30 * 60 * 1000);
const MESSAGE_DEDUPE_TTL_MS = Number(process.env.WHATSAPP_DEDUPE_TTL_MS || 10 * 60 * 1000);
const MAX_EVENT_AGE_SEC = Number(process.env.WHATSAPP_MAX_EVENT_AGE_SEC || 60 * 60 * 24);
const MAX_OUT_OF_ORDER_SEC = Number(process.env.WHATSAPP_MAX_OUT_OF_ORDER_SEC || 120);
const SIGNATURE_REQUIRED =
  String(process.env.WHATSAPP_SIGNATURE_REQUIRED || '').toLowerCase() === 'true';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const SIGNATURE_MAX_SKEW_SEC = Number(
  process.env.WHATSAPP_SIGNATURE_MAX_SKEW_SEC || 10 * 60
);

logger.info(
  `WHATSAPP config loaded provider=${WHATSAPP_PROVIDER} graphVersion=${GRAPH_VERSION} botBarberId=${BOT_BARBER_ID} botMinLead=${BOT_MIN_LEAD_MINUTES} compactMode=${COMPACT_BOOKING_MODE} phoneNumberIdSet=${Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID
  )} tokenSet=${Boolean(process.env.WHATSAPP_TOKEN)} gupshupSourceSet=${Boolean(
    GUPSHUP_SOURCE
  )} gupshupKeySet=${Boolean(GUPSHUP_API_KEY)} aiEnabled=${aiAssistant.isEnabled()}`
);

const reminderLexiconStats = reminderIntentService.getReminderLexiconStats();
logger.info(
  `WHATSAPP reminder lexicon loaded confirm=${reminderLexiconStats.confirmVariants} cancel=${reminderLexiconStats.cancelVariants} total=${reminderLexiconStats.totalVariants}`
);

const sessions = new Map();
const processedMessageIds = new Map();
const lastInboundTimestampBySender = new Map();
const START_INTENTS = [
  'turno',
  'reserv',
  'agend',
  'cita',
  'book',
  'booking',
  'schedule',
  'appointment',
];
const GREETING_INTENTS = [
  'hola',
  'buenas',
  'buen dia',
  'buenas tardes',
  'buenas noches',
  'hi',
  'hello',
  'hey',
];
const THANKS_INTENTS = [
  'gracias',
  'muchas gracias',
  'te agradezco',
  'thanks',
  'thank you',
  'thx',
  'ty',
];
const NEW_BOOKING_INTENTS = [
  'otro turno',
  'quiero otro turno',
  'nuevo turno',
  'another appointment',
  'new appointment',
];
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
  'cancel appointment',
  'cancel booking',
];
const MANAGE_RESCHEDULE_INTENTS = [
  'reprogramar turno',
  'cambiar turno',
  'mover turno',
  'pasar turno',
  'reschedule appointment',
  'change booking',
];
const FLOW_HELP_INTENTS = [
  'que me falta',
  'que falta',
  'en que vamos',
  'en que quedamos',
  'resumen',
  'recordame',
  'repeti',
  'repetime',
  'what am i missing',
  'what is missing',
  'where are we',
];
const FLOW_UNCERTAINTY_INTENTS = [
  'no se',
  'nose',
  'no entendi',
  'no entiendo',
  'me perdi',
  'ayuda',
  'help',
  'explicame',
  'idk',
  'i dont know',
  'dont understand',
];
const AVAILABILITY_INTENTS = [
  'horario',
  'horarios',
  'disponible',
  'disponibilidad',
  'turnos libres',
  'libre',
  'hay libre',
  'tenes libre',
  'tienes libre',
  'available',
  'availability',
  'slot',
  'slots',
  'free slot',
  'free slots',
];
const SLOT_QUERY_INTENTS = [
  'hay turno',
  'hay un turno',
  'algun turno',
  'tienes algun turno',
  'tenes algun turno',
  'tenes turno',
  'tenes un turno',
  'tienes turno',
  'tienes un turno',
  'is there a slot',
  'do you have a slot',
  'do you have',
];
const LIGHT_ACK_INTENTS = [
  'dale',
  'ok',
  'oki',
  'listo',
  'joya',
  'genial',
  'perfecto',
  'de una',
  'buenisimo',
  'buenisima',
  'nos vemos',
];
const BOOKING_ONLY_INTENTS = [
  'quiero turno',
  'quiero reservar',
  'quiero agendar',
  'reservar',
  'agendar',
  'nuevo turno',
  'new appointment',
  'book appointment',
  'book',
  'booking',
];
const TEMPORAL_DISAMBIGUATION_TTL_MS = Number(
  process.env.WHATSAPP_TEMPORAL_DISAMBIGUATION_TTL_MS || 5 * 60 * 1000
);
const VALID_STAGES = new Set([
  'idle',
  'collecting',
  'awaiting_service',
  'awaiting_date',
  'awaiting_time',
  'awaiting_name',
  'awaiting_payment',
  'awaiting_confirm',
  'manage_cancel_collect',
  'manage_reschedule_collect_current',
  'manage_reschedule_collect_new',
]);

const INTENT_ALIAS_REPLACEMENTS = [
  [/\bday after tomorrow\b/g, 'pasado manana'],
  [/\bthis afternoon\b/g, 'esta tarde'],
  [/\bthis evening\b/g, 'esta noche'],
  [/\btonight\b/g, 'esta noche'],
  [/\bnext monday\b/g, 'lunes'],
  [/\bnext tuesday\b/g, 'martes'],
  [/\bnext wednesday\b/g, 'miercoles'],
  [/\bnext thursday\b/g, 'jueves'],
  [/\bnext friday\b/g, 'viernes'],
  [/\bnext saturday\b/g, 'sabado'],
  [/\bnext sunday\b/g, 'domingo'],
  [/\bthis saturday\b/g, 'sabado'],
  [/\bthis sunday\b/g, 'domingo'],
  [/\bmonday\b/g, 'lunes'],
  [/\btuesday\b/g, 'martes'],
  [/\bwednesday\b/g, 'miercoles'],
  [/\bthursday\b/g, 'jueves'],
  [/\bfriday\b/g, 'viernes'],
  [/\bsaturday\b/g, 'sabado'],
  [/\bsunday\b/g, 'domingo'],
  [/\btomorrow\b/g, 'manana'],
  [/\btoday\b/g, 'hoy'],
  [/\bhair ?cut\b/g, 'corte'],
  [/\btrim\b/g, 'corte'],
  [/\bwanna\b/g, 'quiero'],
  [/\bi need\b/g, 'quiero'],
  [/\bcan i\b/g, 'puedo'],
  [/\bgonna\b/g, 'voy a'],
  [/\bpls\b/g, 'porfa'],
  [/\bplz\b/g, 'porfa'],
  [/\bmy name is\b/g, 'mi nombre es'],
  [/\bi am\b/g, 'soy'],
  [/\bi'm\b/g, 'soy'],
  [/\bits for\b/g, 'a nombre de'],
  [/\bit's for\b/g, 'a nombre de'],
  [/\bbeard\b/g, 'barba'],
  [/\bshave\b/g, 'barba'],
  [/\beyebrows?\b/g, 'cejas'],
  [/\bbrows?\b/g, 'cejas'],
  [/\bcash\b/g, 'efectivo'],
  [/\bcard\b/g, 'tarjeta'],
  [/\bbank transfer\b/g, 'transferencia'],
  [/\bwire transfer\b/g, 'transferencia'],
  [/\btransfer\b/g, 'transferencia'],
  [/\bpayment\b/g, 'pago'],
  [/\bpaying\b/g, 'pagar'],
  [/\bbook(ing)?\b/g, 'agendar'],
  [/\bappointment\b/g, 'turno'],
  [/\breschedule\b/g, 'reprogramar'],
  [/\bcancel it\b/g, 'cancelar'],
  [/\bconfirm\b/g, 'confirmar'],
  [/\bslot(s)?\b/g, 'horarios'],
  [/\bavailable\b/g, 'disponible'],
  [/\byes\b/g, 'si'],
  [/\byeah\b/g, 'si'],
  [/\byep\b/g, 'si'],
  [/\byup\b/g, 'si'],
  [/\bokay\b/g, 'ok'],
  [/\ball good\b/g, 'correcto'],
  [/\bthat'?s right\b/g, 'correcto'],
  [/\bcorrect\b/g, 'correcto'],
  [/\bexactly\b/g, 'exacto'],
  [/\bright\b/g, 'correcto'],
  [/\bnope\b/g, 'no'],
  [/\bnah\b/g, 'no'],
  [/\bdude\b/g, 'bro'],
  [/\bmate\b/g, 'bro'],
  [/\bbuddy\b/g, 'bro'],
  [/\bman\b/g, 'bro'],
  [/\bqiero\b/g, 'quiero'],
  [/\bkiero\b/g, 'quiero'],
  [/\bkiere?o\b/g, 'quiero'],
  [/\btenes\b/g, 'tenes'],
  [/\btemes\b/g, 'tenes'],
  [/\benrealidad\b/g, 'en realidad'],
  [/\bat\b/g, 'a las'],
  [/\bone\b/g, 'uno'],
  [/\btwo\b/g, 'dos'],
  [/\bthree\b/g, 'tres'],
  [/\bfour\b/g, 'cuatro'],
  [/\bfive\b/g, 'cinco'],
  [/\bsix\b/g, 'seis'],
  [/\bseven\b/g, 'siete'],
  [/\beight\b/g, 'ocho'],
  [/\bnine\b/g, 'nueve'],
  [/\bten\b/g, 'diez'],
  [/\beleven\b/g, 'once'],
  [/\btwelve\b/g, 'doce'],
  [/\bthirteen\b/g, 'trece'],
  [/\bfourteen\b/g, 'catorce'],
  [/\bfifteen\b/g, 'quince'],
  [/\bsixteen\b/g, 'dieciseis'],
  [/\bseventeen\b/g, 'diecisiete'],
  [/\beighteen\b/g, 'dieciocho'],
  [/\bnineteen\b/g, 'diecinueve'],
  [/\btwenty\b/g, 'veinte'],
  [/\btwenty one\b/g, 'veintiuno'],
  [/\btwenty two\b/g, 'veintidos'],
  [/\btwenty three\b/g, 'veintitres'],
];

function applyIntentAliases(normalizedText) {
  let out = String(normalizedText || '');
  for (const [pattern, replacement] of INTENT_ALIAS_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function normalizeText(texto) {
  const normalized = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return applyIntentAliases(normalized);
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function containsAny(texto, needles) {
  return needles.some(needle => texto.includes(needle));
}

function isNaturalNoShowIntent(msg) {
  const normalized = normalizeText(msg);
  return (
    containsAny(normalized, [
      'no voy a poder',
      'no puedo ir',
      'no voy a ir',
      'no podre ir',
      'no podre asistir',
      'no podre llegar',
      'no llego',
      'se me complica ir',
      'no voy',
      'no puedo asistir',
      'no creo poder ir',
    ]) ||
    /\bno\s+creo\s+poder\s+ir\b/i.test(normalized)
  );
}

function nowMs() {
  return Date.now();
}

function cleanupMapByTtl(map, ttlMs) {
  const now = nowMs();
  for (const [key, value] of map.entries()) {
    if (!value || typeof value.at !== 'number') {
      map.delete(key);
      continue;
    }
    if (now - value.at > ttlMs) {
      map.delete(key);
    }
  }
}

function parseInboundTimestampSeconds(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value > 1e12) return Math.floor(value / 1000);
  return Math.floor(value);
}

function parseIncomingMeta(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  return {
    value,
    incoming: value?.messages?.[0] || null,
  };
}

const GUPSHUP_MESSAGE_TYPES = new Set([
  'text',
  'audio',
  'image',
  'video',
  'file',
  'document',
  'location',
  'button',
  'interactive',
  'list_reply',
  'button_reply',
]);
const GUPSHUP_SANDBOX_PROXY_PATTERNS = [
  /sorry\s+no\s+such\s+keyword/i,
  /no\s+such\s+keyword/i,
  /please\s+use\s+one\s+of\s+the\s+following\s+keywords/i,
  /type\s+start\s+to\s+begin/i,
  /send\s+start\s+to\s+continue/i,
  /this\s+number\s+is\s+connected\s+to\s+gupshup/i,
  /use\s+the\s+keyword\s+/i,
];

function isGupshupSandboxProxyText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  return GUPSHUP_SANDBOX_PROXY_PATTERNS.some(pattern => pattern.test(normalized));
}

function parseIncomingGupshup(body) {
  const root = body || {};
  const payload = root?.payload || {};
  const payloadInner = payload?.payload || {};
  const payloadType = String(payload?.type || payload?.payload?.type || root?.type || '')
    .trim()
    .toLowerCase();

  if (!GUPSHUP_MESSAGE_TYPES.has(payloadType)) {
    return {
      value: null,
      incoming: null,
    };
  }

  const source = String(
    payload?.source ||
      payload?.sender?.phone ||
      payload?.sender?.id ||
      payload?.phone ||
      root?.source ||
      ''
  ).trim();
  const messageId = String(
    payload?.id ||
      payload?.messageId ||
      payload?.gsId ||
      payload?.messageToken ||
      root?.messageId ||
      root?.id ||
      ''
  ).trim();
  const tsRaw = payload?.timestamp || payload?.eventTs || root?.timestamp;
  const tsSeconds = parseInboundTimestampSeconds(tsRaw);

  const textBody = String(
    payloadInner?.text ||
      payloadInner?.body ||
      payloadInner?.content ||
      payloadInner?.title ||
      payload?.text ||
      payload?.message ||
      ''
  ).trim();

  const audioUrl = String(
    payloadInner?.url ||
      payloadInner?.audio?.url ||
      payloadInner?.voice?.url ||
      payload?.url ||
      payload?.audio?.url ||
      payload?.voice?.url ||
      payload?.mediaUrl ||
      payloadInner?.mediaUrl ||
      ''
  ).trim();
  const audioId = String(
    payloadInner?.id ||
      payloadInner?.audio?.id ||
      payloadInner?.voice?.id ||
      payload?.id ||
      payload?.audio?.id ||
      payload?.voice?.id ||
      ''
  ).trim();
  const audioMime = String(
    payloadInner?.contentType ||
      payloadInner?.audio?.contentType ||
      payloadInner?.voice?.contentType ||
      payload?.contentType ||
      payload?.audio?.contentType ||
      payload?.voice?.contentType ||
      payloadInner?.mime_type ||
      payloadInner?.mimeType ||
      payloadInner?.audio?.mime_type ||
      payloadInner?.audio?.mimeType ||
      payload?.audio?.mime_type ||
      payload?.audio?.mimeType ||
      ''
  ).trim();
  const audioDuration = Number(
    payloadInner?.duration || payload?.duration || payloadInner?.duration_sec
  );

  const incomingType = payloadType || (audioUrl ? 'audio' : 'text');
  const incoming = {
    id: messageId || undefined,
    from: source || undefined,
    type: incomingType,
    timestamp: tsSeconds || undefined,
  };

  if (incomingType === 'audio') {
    incoming.audio = {
      id: audioId || undefined,
      mime_type: audioMime || undefined,
      media_url: audioUrl || undefined,
      duration_sec: Number.isFinite(audioDuration) ? audioDuration : undefined,
    };
  } else {
    incoming.text = { body: textBody };
  }

  return {
    value: payload,
    incoming,
  };
}

function parseIncomingByProvider(body) {
  if (WHATSAPP_PROVIDER === 'gupshup') {
    return parseIncomingGupshup(body);
  }
  return parseIncomingMeta(body);
}

function isStaleInboundEvent(tsSeconds) {
  if (!tsSeconds || !MAX_EVENT_AGE_SEC) return false;
  const ageSec = Math.floor(nowMs() / 1000) - tsSeconds;
  return ageSec > MAX_EVENT_AGE_SEC;
}

function isOutOfOrderInboundEvent(from, tsSeconds) {
  if (!from || !tsSeconds) return false;
  cleanupLastInboundTimestamps();
  const previous = lastInboundTimestampBySender.get(from);
  if (!previous) return false;

  return tsSeconds < previous - MAX_OUT_OF_ORDER_SEC;
}

function cleanupLastInboundTimestamps() {
  const nowSec = Math.floor(nowMs() / 1000);
  const ttlSec = Math.max(MAX_EVENT_AGE_SEC * 2, 3600);
  for (const [sender, ts] of lastInboundTimestampBySender.entries()) {
    if (!Number.isFinite(ts) || nowSec - ts > ttlSec) {
      lastInboundTimestampBySender.delete(sender);
    }
  }
}

function rememberInboundTimestamp(from, tsSeconds) {
  if (!from || !tsSeconds) return;
  cleanupLastInboundTimestamps();
  const previous = lastInboundTimestampBySender.get(from) || 0;
  if (tsSeconds > previous) {
    lastInboundTimestampBySender.set(from, tsSeconds);
  }
}

function getSignatureHeader(req) {
  return (
    req.get('x-hub-signature-256') ||
    req.get('X-Hub-Signature-256') ||
    req.get('x-hub-signature') ||
    req.get('X-Hub-Signature') ||
    ''
  );
}

function getSignatureTimestampHeader(req) {
  const raw =
    req.get('x-meta-request-timestamp') ||
    req.get('X-Meta-Request-Timestamp') ||
    req.get('x-signature-timestamp') ||
    req.get('X-Signature-Timestamp') ||
    '';
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) && asNumber > 0 ? Math.floor(asNumber) : null;
}

function validateSignatureTimestamp(req) {
  const ts = getSignatureTimestampHeader(req);
  if (!ts || !SIGNATURE_MAX_SKEW_SEC) return true;
  const skew = Math.abs(Math.floor(nowMs() / 1000) - ts);
  return skew <= SIGNATURE_MAX_SKEW_SEC;
}

function getRawBodyString(req) {
  if (typeof req.rawBody === 'string' && req.rawBody.length) return req.rawBody;
  try {
    return JSON.stringify(req.body || {});
  } catch (_err) {
    return '';
  }
}

function validateMetaSignature(req) {
  if (!META_APP_SECRET) {
    return { ok: !SIGNATURE_REQUIRED, reason: 'missing_app_secret' };
  }

  const signature = getSignatureHeader(req);
  if (!signature) {
    return { ok: !SIGNATURE_REQUIRED, reason: 'missing_signature' };
  }

  if (!validateSignatureTimestamp(req)) {
    return { ok: false, reason: 'expired_signature' };
  }

  const normalized = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;
  const expected = `sha256=${crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(getRawBodyString(req))
    .digest('hex')}`;

  const isSameLength = normalized.length === expected.length;
  const matches =
    isSameLength &&
    crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));

  if (!matches) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return { ok: true, reason: 'ok' };
}

function validateInboundSignature(req) {
  if (WHATSAPP_PROVIDER === 'gupshup') {
    return { ok: true, reason: 'provider_no_signature_validation' };
  }
  return validateMetaSignature(req);
}

function getOutboundConfigError() {
  return whatsappSender.getOutboundConfigError();
}

function getAudioMediaRequestHeadersForProvider() {
  if (WHATSAPP_PROVIDER !== 'gupshup') return undefined;
  if (!GUPSHUP_API_KEY) return undefined;
  return {
    apikey: GUPSHUP_API_KEY,
    'cache-control': 'no-cache',
  };
}

function markMessageProcessing(messageId) {
  if (!messageId) return;
  cleanupMapByTtl(processedMessageIds, MESSAGE_DEDUPE_TTL_MS);
  processedMessageIds.set(messageId, { at: nowMs(), state: 'processing' });
}

function markMessageProcessed(messageId) {
  if (!messageId) return;
  processedMessageIds.set(messageId, { at: nowMs(), state: 'done' });
}

function markMessageProcessedError(messageId) {
  if (!messageId) return;
  processedMessageIds.set(messageId, { at: nowMs(), state: 'error' });
}

function isDuplicateMessageId(messageId) {
  if (!messageId) return false;
  cleanupMapByTtl(processedMessageIds, MESSAGE_DEDUPE_TTL_MS);
  return processedMessageIds.has(messageId);
}

function normalizeIntentText(texto) {
  return String(texto || '')
    .replace(/[?!.,;:"'()¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isConfirmIntent(intentText) {
  const positives = [
    'confirmar',
    'confirmo',
    'confirmado',
    'correcto',
    'correcta',
    'exacto',
    'exacta',
    'asi es',
    'afirmativo',
    'ok',
    'okey',
    'dale',
    'de una',
    'listo',
    'perfecto',
    'joya',
    'si voy',
    'asisto',
    'voy a ir',
  ];
  if (positives.some(p => intentText.includes(p))) return true;

  // Accept natural confirmations like "si bro", "si dale", "sí, quiero".
  if (/^(si|sí)\b/.test(intentText) && !/\bsi no\b/.test(intentText)) return true;
  if (/\b(si|sí)\b/.test(intentText) && intentText.split(/\s+/).length <= 5) return true;

  return intentText === 'si' || intentText === 's' || intentText === '1';
}

function isNegativeConfirmIntent(intentText) {
  return (
    intentText === 'no' ||
    intentText === '2' ||
    intentText.includes('cancelar') ||
    intentText.includes('anular') ||
    intentText.includes('no voy') ||
    intentText.includes('no puedo') ||
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

function parseIsoDate(fecha) {
  const match = String(fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function isoFromParts(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function addDaysFromIso(fecha, days) {
  const parts = parseIsoDate(fecha);
  if (!parts) return fecha;
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + Number(days || 0));
  return isoFromParts({
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  });
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
  const nowParts = businessTime.getNowParts();
  const todayIso = nowParts.fecha;
  const todayParts = parseIsoDate(todayIso);
  const candidates = [];
  const pushCandidate = (index, value) => {
    if (index < 0 || !value) return;
    candidates.push({ index, value });
  };

  const isoRegex = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const match of msg.matchAll(isoRegex)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (isValidDate(year, month, day)) {
      pushCandidate(match.index, `${year}-${pad2(month)}-${pad2(day)}`);
    }
  }

  const slashRegex = /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/g;
  for (const match of msg.matchAll(slashRegex)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const rawYear = match[3];
    let year = rawYear ? Number(rawYear) : Number(todayParts?.year || new Date().getFullYear());
    if (rawYear && rawYear.length === 2) {
      year += 2000;
    }

    if (isValidDate(year, month, day)) {
      pushCandidate(match.index, `${year}-${pad2(month)}-${pad2(day)}`);
    }
  }

  const relCandidates = [
    { token: 'pasado manana', value: addDaysFromIso(todayIso, 2) },
    { token: 'manana', value: addDaysFromIso(todayIso, 1) },
    { token: 'hoy a la tarde', value: todayIso },
    { token: 'hoy a la noche', value: todayIso },
    { token: 'esta tarde', value: todayIso },
    { token: 'esta noche', value: todayIso },
    { token: 'esta maniana', value: todayIso },
    { token: 'hoy', value: todayIso },
  ];
  for (const rel of relCandidates) {
    const index = msg.lastIndexOf(rel.token);
    if (index >= 0) {
      pushCandidate(index, rel.value);
    }
  }

  const weekdayMap = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  const todayUtcDate = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
  const todayDay = todayUtcDate.getUTCDay();
  for (const [name, targetDay] of Object.entries(weekdayMap)) {
    const index = msg.lastIndexOf(name);
    if (index < 0) continue;

    const diff = (targetDay - todayDay + 7) % 7 || 7;
    pushCandidate(index, addDaysFromIso(todayIso, diff));
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[candidates.length - 1].value;
}

function countRegexMatches(msg, regex) {
  let count = 0;
  for (const _ of msg.matchAll(regex)) {
    count += 1;
  }
  return count;
}

function countDateMentions(msg) {
  let count = 0;
  count += countRegexMatches(msg, /\b(\d{4})-(\d{2})-(\d{2})\b/g);
  count += countRegexMatches(msg, /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/g);
  count += countRegexMatches(
    msg,
    /\b(hoy|manana|pasado manana|esta tarde|esta noche|hoy a la tarde|hoy a la noche)\b/g
  );
  count += countRegexMatches(
    msg,
    /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/g
  );
  return count;
}

function parseTime(msg) {
  const HOUR_WORD_MAP = {
    cero: 0,
    un: 1,
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    trece: 13,
    catorce: 14,
    quince: 15,
    dieciseis: 16,
    diecisiete: 17,
    dieciocho: 18,
    diecinueve: 19,
    veinte: 20,
    veintiuno: 21,
    veintiun: 21,
    veintiuna: 21,
    veintidos: 22,
    veintitres: 23,
  };
  const parseHourWord = rawWord => {
    const token = normalizeText(rawWord).replace(/[^a-z]/g, '');
    if (!token) return null;
    return HOUR_WORD_MAP[token] ?? null;
  };

  const candidates = [];
  const pushCandidate = (index, hour, minutes, suffixRaw = '') => {
    const suffix = String(suffixRaw || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/\./g, '');

    let h = Number(hour);
    const m = Number(minutes || 0);
    if (!Number.isInteger(h) || h < 0 || h > 23) return;
    if (!Number.isInteger(m) || m < 0 || m > 59) return;

    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;

    if (!suffix && h >= 1 && h <= 8) {
      h += 12;
    }

    candidates.push({ index, value: `${pad2(h)}:${pad2(m)}` });
  };

  const exactRegex =
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?\s*m\.?|p\.?\s*m\.?)?(?:\s*(?:h|hs|hora|horas))?\b/gi;
  for (const match of msg.matchAll(exactRegex)) {
    pushCandidate(match.index, match[1], match[2], match[3]);
  }

  const contextualNumericRegex =
    /(?:a\s*las|de\s*las|las|para\s*las|a\s*la|la|tipo|como|sobre)\s*([0-2]?\d)(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?(?:\s*(?:h|hs|hora|horas))?\b/gi;
  for (const match of msg.matchAll(contextualNumericRegex)) {
    pushCandidate(match.index, match[1], match[2], match[3]);
  }

  const partOfDayRegex =
    /\b([0-2]?\d)(?::([0-5]\d))?\s*de\s*la\s*(manana|tarde|noche)\b/gi;
  for (const match of msg.matchAll(partOfDayRegex)) {
    let hour = Number(match[1]);
    const minute = match[2] || '00';
    const part = String(match[3] || '').toLowerCase();
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    if (part === 'tarde' && hour >= 1 && hour <= 8) hour += 12;
    if (part === 'noche' && hour >= 1 && hour <= 7) hour += 12;
    if (part === 'manana' && hour === 12) hour = 0;
    pushCandidate(match.index, hour, minute, '');
  }

  const contextualWordRegex =
    /(?:a\s*las|de\s*las|las|para\s*las|a\s*la|la)\s*([a-záéíóúñ]+)\s*(a\.?\s*m\.?|p\.?\s*m\.?)?(?:\s*(?:h|hs|hora|horas|en\s*punto))?\b/gi;
  for (const match of msg.matchAll(contextualWordRegex)) {
    const parsedHour = parseHourWord(match[1]);
    if (parsedHour === null) continue;
    pushCandidate(match.index, parsedHour, 0, match[2]);
  }

  const hsRegex = /\b([0-2]?\d)(?::([0-5]\d))?\s*(?:h|hs|hora|horas)\b/gi;
  for (const match of msg.matchAll(hsRegex)) {
    pushCandidate(match.index, match[1], match[2], '');
  }

  const bareNumericRegex =
    /^\s*(?:a\s*las\s*)?([0-2]?\d)(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\s*(?:h|hs|hora|horas)?\s*$/i;
  const bareNumericMatch = msg.match(bareNumericRegex);
  if (bareNumericMatch) {
    pushCandidate(
      msg.indexOf(String(bareNumericMatch[1] || '')),
      bareNumericMatch[1],
      bareNumericMatch[2],
      bareNumericMatch[3]
    );
  }

  const bareWordRegex =
    /^\s*(?:a\s*las\s*)?([a-záéíóúñ]+)\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\s*(?:h|hs|hora|horas)?\s*$/i;
  const bareWordMatch = msg.match(bareWordRegex);
  if (bareWordMatch) {
    const parsedHour = parseHourWord(bareWordMatch[1]);
    if (parsedHour !== null) {
      pushCandidate(
        msg.indexOf(String(bareWordMatch[1] || '')),
        parsedHour,
        0,
        bareWordMatch[2]
      );
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[candidates.length - 1].value;
}

function countTimeMentions(msg) {
  let count = 0;
  count += countRegexMatches(
    msg,
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?\s*m\.?|p\.?\s*m\.?)?(?:\s*(?:h|hs|hora|horas))?\b/gi
  );
  count += countRegexMatches(
    msg,
    /(?:a\s*las|de\s*las|las|para\s*las|a\s*la|la|tipo|como|sobre)\s*([0-2]?\d)(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?(?:\s*(?:h|hs|hora|horas))?\b/gi
  );
  count += countRegexMatches(
    msg,
    /\b([0-2]?\d)(?::([0-5]\d))?\s*de\s*la\s*(manana|tarde|noche)\b/gi
  );
  count += countRegexMatches(msg, /\b([0-2]?\d)(?::([0-5]\d))?\s*(?:h|hs|hora|horas)\b/gi);
  return count;
}

function hasTemporalCorrectionSignal(msg, dateMentions, timeMentions) {
  if (containsAny(msg, ['perdon', 'mejor', 'quise decir', 'corrijo', 'correccion'])) {
    return true;
  }
  if (/\bno\s*,?\s*mejor\b/.test(msg)) {
    return true;
  }
  if (
    (dateMentions > 1 || timeMentions > 1) &&
    /\b(no|mejor|cambio|cambiar|corrijo|quise decir)\b/.test(msg)
  ) {
    return true;
  }
  return false;
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

function sanitizeNameCandidate(rawCandidate) {
  const STOP_WORDS = new Set([
    'quiero',
    'pagar',
    'efectivo',
    'transferencia',
    'transfer',
    'qr',
    'tarjeta',
    'hoy',
    'manana',
    'pasado',
    'domingo',
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'turno',
    'corte',
    'barba',
    'ceja',
    'cejas',
    'perfilado',
    'confirmar',
    'cancelar',
    'yes',
    'no',
    'ok',
    'okay',
    'correcto',
    'exacto',
    'si',
    'no',
    'ese',
    'esa',
    'este',
    'esta',
    'dia',
    'fecha',
    'hora',
    'metodo',
    'pago',
    'de',
    'del',
    'and',
    'for',
    'with',
    'at',
    'on',
    'i',
    'my',
    'name',
    'is',
    'its',
    'it',
    'pay',
    'please',
    'pls',
    'plz',
    'en',
    'con',
    'para',
    'a',
    'al',
    'las',
    'la',
    'el',
    'los',
    'y',
    'want',
    'book',
    'booking',
    'appointment',
    'today',
    'tomorrow',
  ]);
  const FILLER_WORDS = new Set([
    'ya',
    'lo',
    'sabes',
    'quien',
    'mas',
    'tu',
    'bro',
    'rey',
    'nms',
    'nomas',
    'mano',
    'broo',
    'brooo',
    'broh',
    'brother',
    'sis',
    'sister',
    'dude',
    'mate',
    'buddy',
    'man',
  ]);

  const tokens = String(rawCandidate || '')
    .replace(/[0-9]/g, ' ')
    .replace(/[^\p{L}\s'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => /\p{L}/u.test(token));

  if (!tokens.length) return null;

  const collected = [];
  for (const token of tokens) {
    const normalized = normalizeText(token);
    if (STOP_WORDS.has(normalized)) break;
    if (FILLER_WORDS.has(normalized)) continue;
    collected.push(token);
    if (collected.length >= 4) break;
  }

  const composed = collected.join(' ').trim();
  if (!composed || composed.length < 2 || composed.length > 60) return null;
  if (!/\p{L}/u.test(composed)) return null;
  return composed;
}

function isLightAckMessage(msg) {
  const normalized = normalizeText(msg);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 5) return false;
  return containsAny(normalized, LIGHT_ACK_INTENTS);
}

function detectAvailabilityIntent(msg) {
  return {
    asksAvailability: containsAny(msg, AVAILABILITY_INTENTS),
    asksTurnoAtSlot: containsAny(msg, SLOT_QUERY_INTENTS),
  };
}

function hasExplicitBookingOnlyIntent(msg) {
  return containsAny(msg, BOOKING_ONLY_INTENTS);
}

function didDraftBookingFieldsChange(beforeDraft, afterDraft) {
  const keys = ['servicio', 'fecha', 'hora', 'nombre', 'metodo_pago'];
  return keys.some(key => {
    const before = String(beforeDraft?.[key] || '').trim();
    const after = String(afterDraft?.[key] || '').trim();
    return before !== after;
  });
}

function parseClientName(rawText, options = {}) {
  const allowSingleToken = Boolean(options?.allowSingleToken);
  const raw = String(rawText || '').trim();
  if (!raw) return null;
  const normalizedRaw = normalizeText(raw);

  const multilingualCueRegex =
    /(?:a nombre de|mi nombre es|me llamo|soy|my name is|i am|i'm|im|it's for|its for)\s+(.+)/i;
  const multilingualCueMatches = [
    raw.match(multilingualCueRegex),
    normalizedRaw.match(multilingualCueRegex),
  ];
  for (const cueMatch of multilingualCueMatches) {
    if (!cueMatch?.[1]) continue;
    const candidate = sanitizeNameCandidate(cueMatch[1]);
    if (!candidate || candidate.length < 2 || candidate.length > 60) continue;
    const tokens = candidate.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) return candidate;
    if (tokens.length === 1 && candidate.length >= 3) return candidate;
  }

  const nameCueRegex =
    /(?:a nombre de|mi nombre es|me llamo|soy)\s+([a-záéíóúñü.'-]+(?:\s+[a-záéíóúñü.'-]+){0,3})(?=\s+(?:quiero|pagar|en|con|hoy|manana|mañana|para|a|al|del|de|fecha|hora|metodo|m[eé]todo|servicio)\b|$)/i;
  const cueMatch = raw.match(nameCueRegex);
  if (cueMatch?.[1]) {
    const candidate = sanitizeNameCandidate(cueMatch[1]);
    if (!candidate || candidate.length < 2 || candidate.length > 60) {
      // no-op
    } else {
      const tokens = candidate.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) return candidate;
      if (tokens.length === 1 && candidate.length >= 3) return candidate;
    }
  }

  const cleaned = raw
    .replace(
      /^(me llamo|soy|mi nombre es|a nombre de|my name is|i am|i'm|im|it's for|its for)\s+/i,
      ''
    )
    .replace(/^(a|para)\s+/i, '')
    .replace(
      /\b(ya lo sabes|nms|nomas|bro+|broh|brother|sis|sister|rey|ciejo|ciego|mano|dude|buddy|mate)\b/gi,
      ' '
    )
    .replace(/[0-9]/g, ' ')
    .replace(/[^\p{L}\s'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 80) return null;
  const normalized = normalizeText(cleaned);
  if (detectPaymentMethod(normalized)) return null;
  if (containsAny(normalized, GREETING_INTENTS)) return null;
  if (containsAny(normalized, ['confirmar', 'cancelar', 'turno'])) return null;
  const normalizedTokens = normalized.split(/\s+/).filter(Boolean);
  const nonNameTokens = new Set([
    'si',
    'no',
    'ok',
    'okey',
    'dale',
    'listo',
    'perfecto',
    'joya',
    'correcto',
    'exacto',
    'confirmo',
  ]);
  if (
    normalizedTokens.length &&
    normalizedTokens.every(token => nonNameTokens.has(token))
  ) {
    return null;
  }

  const composed = sanitizeNameCandidate(cleaned);
  if (!composed) return null;
  const tokens = composed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 && !allowSingleToken) return null;
  if (tokens.length === 1 && composed.length < 3) return null;
  return composed;
}

function toNameCase(raw) {
  return String(raw || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
    .trim();
}

function inferNameFromDenseBookingMessage(rawText, msg) {
  const hasEnoughBookingSignals =
    Boolean(detectService(msg)) &&
    Boolean(parseDate(msg)) &&
    Boolean(parseTime(msg)) &&
    Boolean(detectPaymentMethod(msg));
  if (!hasEnoughBookingSignals) return null;

  const explicit = parseClientName(rawText);
  if (explicit) return explicit;

  const stripped = String(rawText || '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ')
    .replace(/\b([01]?\d|2[0-3])(?::[0-5]\d)?\b/g, ' ')
    .replace(/[^\p{L}\s'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stopTokens = new Set([
    'quiero',
    'turno',
    'corte',
    'barba',
    'ceja',
    'cejas',
    'perfilado',
    'pelo',
    'hoy',
    'manana',
    'pasado',
    'domingo',
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'efectivo',
    'transferencia',
    'transfer',
    'qr',
    'tarjeta',
    'pagar',
    'pago',
    'en',
    'con',
    'para',
    'a',
    'al',
    'las',
    'la',
    'el',
    'de',
    'del',
    'y',
    'and',
    'for',
    'with',
    'i',
    'my',
    'name',
    'is',
    'its',
    'it',
    'pay',
    'today',
    'tomorrow',
    'soy',
    'mi',
    'nombre',
    'es',
    'me',
    'llamo',
    'booking',
    'appointment',
    'yes',
    'no',
    'okay',
    'ok',
    'porfa',
    'bro',
    'broo',
    'brooo',
    'dude',
    'mate',
    'buddy',
    'man',
    'rey',
    'nms',
    'nomas',
  ]);

  const nameTokens = stripped
    .split(/\s+/)
    .filter(Boolean)
    .map(token => token.trim())
    .filter(token => !stopTokens.has(normalizeText(token)));

  if (nameTokens.length < 2 || nameTokens.length > 4) return null;
  if (nameTokens.join(' ').length < 2) return null;

  return toNameCase(nameTokens.join(' '));
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

function createEmptySession(seed = {}) {
  const createdAt = nowMs();
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
    memory: {
      lastReferencedDate: seed.lastReferencedDate || null,
      pendingTemporalDisambiguation: null,
    },
    meta: {
      createdAt,
      updatedAt: createdAt,
      expiredFromStage: seed.expiredFromStage || null,
    },
  };
}

function getSession(from) {
  const current = sessions.get(from);
  if (!current) {
    const created = createEmptySession();
    sessions.set(from, created);
    return created;
  }

  const updatedAt = Number(current.meta?.updatedAt || 0);
  if (updatedAt && nowMs() - updatedAt > SESSION_TTL_MS) {
    const recreated = createEmptySession({
      lastReferencedDate: current?.memory?.lastReferencedDate || current?.draft?.fecha || null,
      expiredFromStage: current.stage,
    });
    sessions.set(from, recreated);
    return recreated;
  }

  return current;
}

function resetSession(from) {
  const current = sessions.get(from);
  const lastReferencedDate =
    current?.draft?.fecha ||
    current?.manage?.nuevaFecha ||
    current?.manage?.fecha ||
    current?.memory?.lastReferencedDate ||
    null;

  sessions.set(from, createEmptySession({ lastReferencedDate }));
}

function touchSession(session) {
  if (!session.meta) {
    session.meta = { createdAt: nowMs(), updatedAt: nowMs(), expiredFromStage: null };
  }
  session.meta.updatedAt = nowMs();
}

function ensureSessionIntegrity(session) {
  if (!VALID_STAGES.has(session.stage)) {
    session.stage = 'idle';
  }

  if (session.stage === 'awaiting_confirm') {
    const required = [
      session.draft.servicio,
      session.draft.fecha,
      session.draft.hora,
      session.draft.nombre,
      session.draft.metodo_pago,
    ];
    if (required.some(v => !v)) {
      session.stage = 'collecting';
    }
  }

  if (
    session.stage === 'manage_reschedule_collect_new' &&
    !session.manage.turnoId
  ) {
    session.stage = 'manage_reschedule_collect_current';
  }

  if (session.stage === 'awaiting_payment' && !session.draft.nombre) {
    session.stage = 'awaiting_name';
  }

  const pending = session.memory?.pendingTemporalDisambiguation;
  if (pending?.at && nowMs() - pending.at > TEMPORAL_DISAMBIGUATION_TTL_MS) {
    session.memory.pendingTemporalDisambiguation = null;
  }

  touchSession(session);
}

function getCurrentSlotAvailability(fecha, hora) {
  const disponibles = turnosService.obtenerDisponibilidad(fecha, BOT_BARBER_ID, {
    includePastForToday: false,
    minLeadMinutes: BOT_MIN_LEAD_MINUTES,
  }).disponibles;
  return disponibles.includes(hora);
}

function parseDateWithContext(msg, session) {
  const parsedDate = parseDate(msg);
  if (parsedDate) return parsedDate;

  if (
    session?.memory?.lastReferencedDate &&
    containsAny(msg, ['mismo dia', 'ese dia', 'dia de recien', 'mismo de recien'])
  ) {
    return session.memory.lastReferencedDate;
  }

  return null;
}

function applyNonTemporalDetections(session, msg) {
  const servicio = detectService(msg);
  if (servicio) session.draft.servicio = servicio;

  const metodoPago = detectPaymentMethod(msg);
  if (metodoPago) session.draft.metodo_pago = metodoPago;

  if (containsAny(msg, ['a nombre de', 'es para', 'para otra persona'])) {
    session.draft.explicitOtherPerson = true;
  }
}

function applyTemporalDetections(session, msg) {
  const fecha = parseDateWithContext(msg, session);
  if (fecha) {
    session.draft.fecha = fecha;
    session.memory.lastReferencedDate = fecha;
  }

  const hora = parseTime(msg);
  if (hora) session.draft.hora = hora;
}

function applyDetections(session, msg) {
  applyNonTemporalDetections(session, msg);
  applyTemporalDetections(session, msg);
}

function applyPendingTemporalDisambiguation(session, pending) {
  if (!pending) return;
  if (pending.fecha) {
    session.draft.fecha = pending.fecha;
    session.memory.lastReferencedDate = pending.fecha;
  }
  if (pending.hora) {
    session.draft.hora = pending.hora;
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
  if (COMPACT_BOOKING_MODE) {
    return `Resumen: ${draft.nombre}, ${draft.servicio}, ${draft.fecha} ${draft.hora}, pago ${draft.metodo_pago}. Responde "confirmar" para cerrar.`;
  }
  return `Te resumo: ${draft.nombre}, ${draft.servicio}, ${draft.fecha} a las ${draft.hora}, pago ${draft.metodo_pago}. Recorda que el pago se realiza despues del corte. Si queres confirmar, responde "confirmar".`;
}

function getMissingBookingFields(draft) {
  const missing = [];
  if (!draft?.servicio) missing.push('servicio');
  if (!draft?.fecha) missing.push('fecha');
  if (!draft?.hora) missing.push('hora');
  if (!draft?.nombre) missing.push('nombre');
  if (!draft?.metodo_pago) missing.push('metodo_pago');
  return missing;
}

function buildCompactBookingPrompt(session) {
  const missing = getMissingBookingFields(session?.draft || {});
  if (!missing.length) {
    return buildSummaryMessage(session.draft);
  }

  const labels = {
    servicio: 'servicio',
    fecha: 'fecha',
    hora: 'hora',
    nombre: 'nombre',
    metodo_pago: 'metodo de pago',
  };

  const orderedMissing = missing.map(key => labels[key]);
  const intro =
    orderedMissing.length === 5
      ? 'Para agendar rapido en menos mensajes, pasame en un solo mensaje:'
      : 'Para completar la reserva, me falta:';

  let response = `${intro} ${orderedMissing.join(', ')}.`;

  if (session?.draft?.fecha && !session?.draft?.hora) {
    response += ` ${buildAvailabilityMessage(session.draft.fecha)}`;
  }

  response +=
    ' Ejemplo: "corte, 2026-03-10, 16:00, Juan Perez, efectivo". El pago se realiza despues del corte.';

  return response;
}

function buildTemporalDisambiguationPrompt(pending, remind = false) {
  if (!pending) return 'Para evitar errores, decime de nuevo fecha y hora.';
  const parts = [];
  if (pending.fecha) parts.push(`fecha ${pending.fecha}`);
  if (pending.hora) parts.push(`hora ${pending.hora}`);
  if (!parts.length) return 'Para evitar errores, decime de nuevo fecha y hora.';

  const intro = remind ? 'Seguimos pendientes de esta confirmacion.' : 'Para evitar errores,';
  return `${intro} entendi ${parts.join(' y ')}. Responde "si" para continuar o enviame solo el dato correcto.`;
}

function maybeStartTemporalDisambiguation(session, msg) {
  const dateMentions = countDateMentions(msg);
  const timeMentions = countTimeMentions(msg);
  const hasMultipleTemporalHints = dateMentions > 1 || timeMentions > 1;
  if (!hasMultipleTemporalHints) return null;
  if (!hasTemporalCorrectionSignal(msg, dateMentions, timeMentions)) return null;

  const fecha = parseDateWithContext(msg, session);
  const hora = parseTime(msg);
  if (!fecha && !hora) return null;

  session.memory.pendingTemporalDisambiguation = {
    fecha: fecha || null,
    hora: hora || null,
    at: nowMs(),
  };

  return buildTemporalDisambiguationPrompt(session.memory.pendingTemporalDisambiguation);
}

function getProgressPrompt(session) {
  if (!session) {
    return 'Si queres reservar, escribi "turno".';
  }

  if (session.memory?.pendingTemporalDisambiguation) {
    return buildTemporalDisambiguationPrompt(session.memory.pendingTemporalDisambiguation, true);
  }

  if (
    COMPACT_BOOKING_MODE &&
    !String(session.stage || '').startsWith('manage_') &&
    session.stage !== 'awaiting_confirm'
  ) {
    return buildCompactBookingPrompt(session);
  }

  switch (session.stage) {
    case 'awaiting_service':
      return 'Nos falta el servicio. Opciones: corte, recorte/tratamiento de barba, perfilado de cejas.';
    case 'awaiting_date':
      return 'Nos falta la fecha (ej: 2026-02-23 o 23/02/2026).';
    case 'awaiting_time':
      return `Nos falta la hora. ${buildAvailabilityMessage(
        session.draft.fecha || formatDateLocal(new Date())
      )} Decime una hora (ej: 15:00).`;
    case 'awaiting_name':
      return 'Nos falta el nombre para agendar (ej: Juan Perez).';
    case 'awaiting_payment':
      return 'Nos falta el metodo de pago (efectivo, transferencia/QR, tarjeta).';
    case 'awaiting_confirm':
      return `${buildSummaryMessage(session.draft)} Si queres seguir, responde "confirmar".`;
    case 'manage_cancel_collect':
      return 'Para cancelar, decime nombre y fecha del turno (ej: Fernando Vallejos, 2026-02-24).';
    case 'manage_reschedule_collect_current':
      return 'Para reprogramar, decime nombre y fecha del turno actual (ej: Fernando Vallejos, 2026-02-24).';
    case 'manage_reschedule_collect_new':
      return 'Decime la nueva fecha y hora del turno (ej: 2026-02-25 16:00).';
    default:
      break;
  }

  if (session.draft.servicio || session.draft.fecha || session.draft.hora) {
    if (!session.draft.servicio) return 'Falta el servicio para continuar.';
    if (!session.draft.fecha) return 'Falta la fecha para continuar.';
    if (!session.draft.hora) return 'Falta la hora para continuar.';
    if (!session.draft.nombre) return 'Falta el nombre para continuar.';
    if (!session.draft.metodo_pago) return 'Falta el metodo de pago para continuar.';
  }

  return 'Si queres reservar, escribi "turno".';
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

function isReminderCancelMessage(msg) {
  return reminderIntentService.resolveReminderIntent(msg).intent === 'cancel';
}

function isReminderConfirmMessage(msg, intentText) {
  const resolved = reminderIntentService.resolveReminderIntent(msg).intent;
  if (resolved === 'cancel') return false;
  if (resolved === 'confirm') return true;
  return isConfirmIntent(intentText);
}

function tryHandleActiveReminderResponse(from, msg, intentText) {
  const activeReminder = turnosService.getRecordatorioActivo(from);
  if (!activeReminder) return null;
  const reminderIntent = reminderIntentService.resolveReminderIntent(msg);
  const resolvedIntent =
    reminderIntent.intent === 'unknown' && isConfirmIntent(intentText)
      ? 'confirm'
      : reminderIntent.intent;

  if (resolvedIntent === 'cancel') {
    turnosService.responderRecordatorio({
      id: activeReminder.id,
      accion: 'cancelar',
      cliente_id: from,
    });
    return `Entendido, cancele tu turno de ${activeReminder.fecha} a las ${activeReminder.hora}.`;
  }

  if (resolvedIntent === 'confirm' || isReminderConfirmMessage(msg, intentText)) {
    turnosService.responderRecordatorio({
      id: activeReminder.id,
      accion: 'confirmar',
      cliente_id: from,
    });
    return `Perfecto, te esperamos a las ${activeReminder.hora}.`;
  }

  return `Tu turno es ${activeReminder.fecha} a las ${activeReminder.hora}. Responde 1 (si voy) o 2 (no voy/cancelar).`;
}

async function buildReply(from, texto, _context = {}) {
  const msg = normalizeText(texto);
  let session = getSession(from);
  ensureSessionIntegrity(session);
  const intentText = normalizeIntentText(msg);
  const confirms = isConfirmIntent(intentText);
  const rejectsConfirmation = isNegativeConfirmIntent(intentText);

  if (!msg) {
    return COMPACT_BOOKING_MODE
      ? buildCompactBookingPrompt(session)
      : 'Escribime que servicio, fecha y hora queres reservar.';
  }

  const reminderReply = tryHandleActiveReminderResponse(from, msg, intentText);
  if (reminderReply) {
    return reminderReply;
  }

  const wantsManageCancelCommand =
    containsAny(msg, MANAGE_CANCEL_INTENTS) ||
    (msg.includes('cancelar') && msg.includes('turno'));
  const wantsManageRescheduleCommand =
    containsAny(msg, MANAGE_RESCHEDULE_INTENTS) ||
    msg.includes('reprogramar') ||
    (msg.includes('cambiar') && msg.includes('turno'));
  const wantsExplicitBooking = hasExplicitBookingOnlyIntent(msg);
  const wantsStart = containsAny(msg, START_INTENTS);
  const asksFlowHelp = containsAny(msg, FLOW_HELP_INTENTS);
  const expressesUncertainty = containsAny(msg, FLOW_UNCERTAINTY_INTENTS);

  if (
    (wantsManageCancelCommand || wantsManageRescheduleCommand) &&
    wantsExplicitBooking
  ) {
    return 'Veo una mezcla de acciones. Primero decime si queres gestionar un turno existente (cancelar/reprogramar) o crear uno nuevo.';
  }

  if (wantsManageCancelCommand && wantsManageRescheduleCommand) {
    return 'Te ayudo con eso. Primero decime si queres cancelar o reprogramar. Ejemplos: "cancelar turno" o "reprogramar turno".';
  }

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

  if (!wantsManageCancelCommand && !wantsManageRescheduleCommand && containsAny(msg, THANKS_INTENTS)) {
    const hasActiveFlow =
      session.stage !== 'idle' ||
      Boolean(
        session.draft.servicio ||
          session.draft.fecha ||
          session.draft.hora ||
          session.draft.nombre ||
          session.draft.metodo_pago
      );

    if (hasActiveFlow) {
      return `De nada. Seguimos con la reserva. ${getProgressPrompt(session)}`;
    }

    resetSession(from);
    return 'De nada. Cuando quieras, estoy para ayudarte.';
  }

  if (asksFlowHelp || expressesUncertainty) {
    return getProgressPrompt(session);
  }

  if (containsAny(msg, NEW_BOOKING_INTENTS)) {
    resetSession(from);
    session = getSession(from);
    session.stage = 'collecting';
    touchSession(session);
    if (COMPACT_BOOKING_MODE) {
      return `Perfecto. Empecemos de nuevo. ${buildCompactBookingPrompt(session)}`;
    }
    return 'Perfecto. Empecemos de nuevo. Que servicio queres? (corte, recorte/tratamiento de barba, perfilado de cejas)';
  }

  if (
    !wantsManageCancelCommand &&
    !wantsManageRescheduleCommand &&
    (containsAny(msg, ['cancelar', 'anular', 'salir', 'reiniciar']) || isNaturalNoShowIntent(msg))
  ) {
    const explicitFlowCancel = containsAny(msg, ['cancelar', 'anular', 'salir', 'reiniciar']);
    const wantsBookingCancel = explicitFlowCancel || isNaturalNoShowIntent(msg);

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
        if (!explicitFlowCancel) {
          return 'Entiendo. No encontre un turno activo para cancelar ahora. Si queres reservar otro, decime servicio, fecha y hora.';
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

  if (session.memory?.pendingTemporalDisambiguation) {
    if (confirms) {
      applyPendingTemporalDisambiguation(session, session.memory.pendingTemporalDisambiguation);
      session.memory.pendingTemporalDisambiguation = null;
    } else if (rejectsConfirmation) {
      session.memory.pendingTemporalDisambiguation = null;
      return 'Perfecto. Decime de nuevo fecha y hora para evitar errores (ej: 2026-02-25 a las 16:00).';
    } else {
      const fechaCorregida = parseDateWithContext(msg, session);
      const horaCorregida = parseTime(msg);
      if (fechaCorregida || horaCorregida) {
        const pending = session.memory.pendingTemporalDisambiguation;
        session.memory.pendingTemporalDisambiguation = {
          fecha: fechaCorregida || pending.fecha || null,
          hora: horaCorregida || pending.hora || null,
          at: nowMs(),
        };
      }
      const { asksAvailability, asksTurnoAtSlot } = detectAvailabilityIntent(msg);
      if (asksAvailability || asksTurnoAtSlot) {
        applyPendingTemporalDisambiguation(session, session.memory.pendingTemporalDisambiguation);
        session.memory.pendingTemporalDisambiguation = null;
      } else {
        return buildTemporalDisambiguationPrompt(session.memory.pendingTemporalDisambiguation, true);
      }
    }
  }

  if (!wantsManageCancelCommand && !wantsManageRescheduleCommand) {
    const temporalDisambiguationPrompt = maybeStartTemporalDisambiguation(session, msg);
    if (temporalDisambiguationPrompt) {
      applyNonTemporalDetections(session, msg);
      return temporalDisambiguationPrompt;
    }
  }

  const stageBeforeDetections = session.stage;
  const draftBeforeDetections = {
    ...session.draft,
  };
  applyDetections(session, msg);
  if (!session.draft.nombre) {
    const inferredName = parseClientName(texto) || inferNameFromDenseBookingMessage(texto, msg);
    if (inferredName) {
      session.draft.nombre = inferredName;
    }
  }
  ensureSessionIntegrity(session);

  const changedDraftWhileAwaitingConfirm =
    stageBeforeDetections === 'awaiting_confirm' &&
    session.stage === 'awaiting_confirm' &&
    didDraftBookingFieldsChange(draftBeforeDetections, session.draft);
  if (changedDraftWhileAwaitingConfirm && confirms) {
    return `${buildSummaryMessage(session.draft)} Si esta correcto, responde "confirmar".`;
  }

  if (session.stage === 'awaiting_name') {
    const name = parseClientName(texto, { allowSingleToken: true });
    if (name) {
      session.draft.nombre = name;
    } else if (!session.draft.nombre) {
      const suppliedTemporalData = Boolean(parseDateWithContext(msg, session) || parseTime(msg));
      if (!suppliedTemporalData) {
        return 'Necesito un nombre valido para agendar. Ejemplo: Juan Perez.';
      }
      // If user sends temporal data while awaiting_name, keep flow moving instead of hard-stopping.
      session.stage = 'collecting';
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
      const proximo = turnosService.getProximoTurnoPorClienteId(from);
      if (proximo) {
        session.manage.turnoId = proximo.id;
        session.manage.turnoOriginalFecha = proximo.fecha;
        session.manage.turnoOriginalHora = proximo.hora;
        session.stage = 'manage_reschedule_collect_new';
        return `Encontre tu proximo turno (${proximo.fecha} ${proximo.hora}). Decime la nueva fecha y hora (ej: 2026-02-25 16:00).`;
      }

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

  const { asksAvailability, asksTurnoAtSlot } = detectAvailabilityIntent(msg);

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
        return `Si, ${session.draft.fecha} a las ${session.draft.hora} esta disponible ahora. Si queres reservar, decime el servicio (la disponibilidad se confirma al agendar).`;
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
    wantsStart
  ) {
    const isAvailable = getCurrentSlotAvailability(session.draft.fecha, session.draft.hora);
    session.lastAvailability = {
      fecha: session.draft.fecha,
      hora: session.draft.hora,
      available: isAvailable,
    };

    if (!isAvailable) {
      session.stage = 'awaiting_time';
      session.draft.hora = null;
      return `Ese horario se ocupo recien. ${buildAvailabilityMessage(
        session.draft.fecha
      )} Decime otra hora.`;
    }
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
      if (COMPACT_BOOKING_MODE) {
        return 'Hola! Para reservar rapido, manda: servicio, fecha, hora, nombre, pago. Ej: corte, 2026-03-10, 16:00, Juan Perez, efectivo.';
      }
      return 'Hola! Soy ZZETA Bot. Si queres reservar, escribi "turno".';
    }

    if (containsAny(msg, THANKS_INTENTS)) {
      return 'De nada. Cuando quieras, estoy para ayudarte.';
    }

    if (isLightAckMessage(msg)) {
      return 'Perfecto. Cualquier cosa escribime "turno" y lo hacemos rapido.';
    }

    const aiReply = await maybeAiFallback(texto, session);
    if (aiReply) return aiReply;

    if (COMPACT_BOOKING_MODE) {
      return 'Puedo reservar en 1 mensaje: servicio, fecha, hora, nombre y pago.';
    }
    return 'Puedo ayudarte a reservar. Escribi "turno" para empezar.';
  }

  if (session.stage === 'idle') {
    session.stage = 'collecting';
  }

  if (!session.draft.servicio) {
    session.stage = 'awaiting_service';
    if (COMPACT_BOOKING_MODE) {
      return buildCompactBookingPrompt(session);
    }
    return 'Perfecto. Que servicio queres? (corte, recorte/tratamiento de barba, perfilado de cejas)';
  }

  if (!session.draft.fecha) {
    session.stage = 'awaiting_date';
    if (COMPACT_BOOKING_MODE) {
      return buildCompactBookingPrompt(session);
    }
    return 'Genial. Para que fecha queres el turno? (ej: 2026-02-23 o 23/02/2026)';
  }

  if (turnosService.esFechaPasada(session.draft.fecha)) {
    session.draft.fecha = null;
    session.draft.hora = null;
    session.stage = 'awaiting_date';
    return 'Esa fecha ya paso. Decime una fecha igual o posterior a hoy (ej: 2026-02-23).';
  }

  const turnosActivosDelNumero = turnosService.getTurnosFuturosPorClienteId(from);
  if (turnosActivosDelNumero.length && !session.draft.explicitOtherPerson) {
    const yaAgendado = turnosActivosDelNumero[0];
    session.stage = 'awaiting_name';
    return `Ya tenes un turno activo el ${yaAgendado.fecha} a las ${yaAgendado.hora} (${yaAgendado.servicio}). Si queres cambiarlo, escribi "reprogramar turno". Si queres cancelarlo, escribi "cancelar". Si este nuevo turno es para otra persona, responde: "a nombre de Nombre Apellido".`;
  }

  if (!session.draft.hora) {
    session.stage = 'awaiting_time';
    if (COMPACT_BOOKING_MODE) {
      return buildCompactBookingPrompt(session);
    }
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
    if (COMPACT_BOOKING_MODE) {
      return buildCompactBookingPrompt(session);
    }
    return 'Perfecto. A nombre de quien agendo el turno?';
  }

  if (!session.draft.metodo_pago) {
    session.stage = 'awaiting_payment';
    if (COMPACT_BOOKING_MODE) {
      return buildCompactBookingPrompt(session);
    }
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

  if (mode) {
    if (token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // Compatibilidad con validadores de webhook (ej: Gupshup) que hacen un GET simple.
  return res.status(200).json({ ok: true, provider: WHATSAPP_PROVIDER });
});

router.post('/', async (req, res) => {
  try {
    const debugMode = req.headers['x-webhook-debug'] === '1';
    const signature = validateInboundSignature(req);
    if (!signature.ok) {
      logger.warn(`WHATSAPP signature rejected reason=${signature.reason}`);
      if (debugMode) {
        return res.status(403).json({ ok: false, reason: signature.reason });
      }
      return res.sendStatus(403);
    }

    const botEnabled = settingsRepo.getBoolean('bot_enabled', true);

    if (!botEnabled) {
      logger.info('WHATSAPP bot disabled, inbound ignored');
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'bot_disabled' });
      }
      return res.sendStatus(200);
    }

    const parsedIncoming = parseIncomingByProvider(req.body);
    const incoming = parsedIncoming.incoming;

    if (!incoming) {
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'no_message_event' });
      }
      return res.sendStatus(200);
    }

    const isAudioInbound = Boolean(incoming.audio) || incoming.type === 'audio';
    const fromRaw = String(incoming.from || '').trim();
    const from = normalizePhone(fromRaw) || fromRaw;
    if (!from) {
      logger.warn('WHATSAPP inbound ignored: missing sender');
      if (isAudioInbound) {
        audioMetrics.record({
          discarded: true,
          reason: 'invalid_inbound_payload',
          failureType: 'audio',
        });
      }
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'invalid_inbound_payload' });
      }
      return res.sendStatus(200);
    }

    // Evita loops cuando el proveedor reinyecta eventos originados por nuestro mismo numero.
    if (
      WHATSAPP_PROVIDER === 'gupshup' &&
      normalizePhone(GUPSHUP_SOURCE) &&
      normalizePhone(from) === normalizePhone(GUPSHUP_SOURCE)
    ) {
      logger.info(`WHATSAPP provider echo ignored from=${from}`);
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'provider_echo' });
      }
      return res.sendStatus(200);
    }

    const inboundTimestamp = parseInboundTimestampSeconds(incoming.timestamp);
    if (isStaleInboundEvent(inboundTimestamp)) {
      logger.info(`WHATSAPP stale inbound ignored from=${from} ts=${incoming.timestamp}`);
      if (isAudioInbound) {
        audioMetrics.record({
          discarded: true,
          reason: 'stale_event',
          failureType: 'timing',
        });
      }
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'stale_event' });
      }
      return res.sendStatus(200);
    }

    if (isOutOfOrderInboundEvent(from, inboundTimestamp)) {
      logger.info(`WHATSAPP out-of-order inbound ignored from=${from} ts=${incoming.timestamp}`);
      if (isAudioInbound) {
        audioMetrics.record({
          discarded: true,
          outOfOrder: true,
          reason: 'out_of_order_event',
          failureType: 'timing',
        });
      }
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'out_of_order_event' });
      }
      return res.sendStatus(200);
    }

    const texto =
      incoming.text?.body ||
      incoming.button?.text ||
      incoming.interactive?.button_reply?.title ||
      incoming.interactive?.list_reply?.title ||
      '';

    if (
      WHATSAPP_PROVIDER === 'gupshup' &&
      incoming.type === 'text' &&
      isGupshupSandboxProxyText(texto)
    ) {
      logger.warn(
        `WHATSAPP sandbox proxy message ignored from=${from} text="${String(texto).slice(0, 180)}"`
      );
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'gupshup_sandbox_proxy_message' });
      }
      return res.sendStatus(200);
    }

    logger.info(`WHATSAPP inbound from=${from} type=${incoming.type || 'text'} text="${texto}"`);

    const incomingMessageId = String(incoming.id || '').trim();
    const dedupeId = incomingMessageId || null;
    if (isDuplicateMessageId(dedupeId)) {
      logger.info(`WHATSAPP duplicate inbound ignored messageId=${dedupeId}`);
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'duplicate_event' });
      }
      return res.sendStatus(200);
    }
    markMessageProcessing(dedupeId);
    rememberInboundTimestamp(from, inboundTimestamp);

    const outboundConfigError = getOutboundConfigError();
    if (outboundConfigError) {
      const msg = outboundConfigError;
      logger.error(msg);
      const outboundSnapshot = whatsappSender.getOutboundConfigSnapshot();
      if (debugMode) {
        return res.status(500).json({
          ok: false,
          error: msg,
          provider: WHATSAPP_PROVIDER,
          phoneNumberIdSet: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
          tokenSet: Boolean(process.env.WHATSAPP_TOKEN),
          gupshupSourceSet: Boolean(GUPSHUP_SOURCE),
          gupshupKeySet: Boolean(GUPSHUP_API_KEY),
          graphVersion: GRAPH_VERSION,
          outboundSnapshot,
        });
      }
      markMessageProcessedError(dedupeId);
      return res.sendStatus(200);
    }

    let replyText = '';
    let audioResult = null;
    if (isAudioInbound) {
      audioResult = await audioPipeline.processAudioMessage({
        incoming,
        from,
        accessToken: process.env.WHATSAPP_TOKEN,
        graphVersion: GRAPH_VERSION,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        buildReply,
        provider: WHATSAPP_PROVIDER,
        mediaRequestHeaders: getAudioMediaRequestHeadersForProvider(),
      });
      replyText = String(audioResult?.reply || '').trim();
    } else {
      replyText = String(await buildReply(from, texto, { source: 'text' }) || '').trim();
    }

    if (!replyText) {
      replyText = 'No pude procesar tu mensaje. Proba de nuevo en unos minutos.';
    }

    const outbound = await whatsappSender.sendSafe(from, replyText, {
      path: '/meta-webhook',
      source: isAudioInbound ? 'audio' : 'text',
      dedupeId,
      from,
    });
    if (!outbound.ok) {
      logger.error(`WHATSAPP send failed provider=${WHATSAPP_PROVIDER} status=${outbound.status} body=${outbound.bodyText}`);
      markMessageProcessedError(dedupeId);
      if (debugMode) {
        return res.status(outbound.status).json({
          ok: false,
          provider: WHATSAPP_PROVIDER,
          graphStatus: outbound.status,
          graphBody: outbound.bodyText,
        });
      }
      return res.sendStatus(200);
    }

    const data = outbound.payload || {};
    const outboundId =
      data.messages?.[0]?.id || data.messageId || data.id || data.data?.messageId || 'n/a';
    logger.info(`WHATSAPP outbound ok provider=${WHATSAPP_PROVIDER} messageId=${outboundId}`);
    markMessageProcessed(dedupeId);
    if (debugMode) {
      return res.status(200).json({
        ok: true,
        provider: WHATSAPP_PROVIDER,
        outbound: data,
        audio: audioResult,
      });
    }
    return res.sendStatus(200);
  } catch (err) {
    const incoming = parseIncomingByProvider(req.body).incoming;
    if (incoming?.id) {
      markMessageProcessedError(String(incoming.id));
    }
    logger.error(`WHATSAPP webhook error: ${err.stack || err.message}`);
    if (req.headers['x-webhook-debug'] === '1') {
      return res.status(500).json({ ok: false, error: err.message });
    }
    return res.sendStatus(200);
  }
});

module.exports = router;
