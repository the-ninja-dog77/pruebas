#!/usr/bin/env node
/* eslint-disable no-console */
const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'zzeta_super_secreto';
process.env.DB_PATH = process.env.DB_PATH || `zzeta.soak.${Date.now()}.db`;
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1234567890';
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test_token';
process.env.WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v24.0';
process.env.BOT_MIN_LEAD_MINUTES = process.env.BOT_MIN_LEAD_MINUTES || '0';
process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'meta_app_secret_soak';
process.env.WHATSAPP_SIGNATURE_REQUIRED = process.env.WHATSAPP_SIGNATURE_REQUIRED || 'true';
process.env.AUDIO_STT_PROVIDER = process.env.AUDIO_STT_PROVIDER || 'groq';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'gsk_test_key';
process.env.AUDIO_RETRY_BACKOFF_MS = process.env.AUDIO_RETRY_BACKOFF_MS || '50';
process.env.AUDIO_STT_RETRIES = process.env.AUDIO_STT_RETRIES || '1';
process.env.AUDIO_MEDIA_METADATA_RETRIES = process.env.AUDIO_MEDIA_METADATA_RETRIES || '1';
process.env.AUDIO_MEDIA_DOWNLOAD_RETRIES = process.env.AUDIO_MEDIA_DOWNLOAD_RETRIES || '1';

const app = require('../index');

const PHASE_SCALE = Number(process.env.SOAK_PHASE_SCALE || '1');
const DEFAULT_DURATION_MS = Math.max(1000, Math.round(60 * 60 * 1000 * PHASE_SCALE));
const DURATION_MS = Number(process.env.SOAK_DURATION_MS || DEFAULT_DURATION_MS);
const TICK_MS = Number(process.env.SOAK_TICK_MS || 1000);
const PROGRESS_EVERY_MS = Number(process.env.SOAK_PROGRESS_EVERY_MS || 30000);
const USER_POOL_SIZE = Number(process.env.SOAK_USER_POOL_SIZE || 1200);
const ADAPTIVE_PROFILE_ENABLED = process.env.SOAK_ADAPTIVE_PROFILE !== 'false';

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const HISTORY_PATH = path.join(REPORTS_DIR, 'bot-soak-1h.history.json');
const ADAPTIVE_PROFILE_PATH = path.join(REPORTS_DIR, 'bot-soak-1h.adaptive-profile.json');
const NEXT_ACTIONS_PATH = path.join(REPORTS_DIR, 'bot-soak-1h.next-actions.json');

const TARGETS = {
  errorRatePercent: 1.0,
  retryRatioPercent: 5.0,
  dropRatePercent: 1.0,
  p95LatencyMs: 1200,
  p99LatencyMs: 3000,
  fiveXxPercent: 0.5,
  coverageMinSentPerPhase: 50,
  audioFailurePercent: 8.0,
};

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function writeJsonFile(filePath, value) {
  ensureReportsDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function round2(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function toPercent(part, total) {
  if (!total) return 0;
  return round2((part / total) * 100);
}

function sumHistogram(histogram = {}) {
  return Object.values(histogram).reduce((acc, value) => acc + Number(value || 0), 0);
}

function topHistogram(histogram = {}, limit = 8) {
  return Object.entries(histogram)
    .map(([key, count]) => ({ key, count: Number(count || 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function defaultAdaptiveProfile() {
  return {
    version: 1,
    updatedAt: null,
    lastScore: null,
    notes: 'Perfil adaptativo de carga; no modifica codigo del bot.',
    phaseAdjustments: {
      normal: {
        audioRatioDelta: 0,
        weirdRatioDelta: 0,
        rudeRatioDelta: 0,
        duplicateChanceDelta: 0,
        outOfOrderChanceDelta: 0,
        nonDebugAudioChanceDelta: 0,
      },
      raras: {
        audioRatioDelta: 0,
        weirdRatioDelta: 0,
        rudeRatioDelta: 0,
        duplicateChanceDelta: 0,
        outOfOrderChanceDelta: 0,
        nonDebugAudioChanceDelta: 0,
      },
      desubicados: {
        audioRatioDelta: 0,
        weirdRatioDelta: 0,
        rudeRatioDelta: 0,
        duplicateChanceDelta: 0,
        outOfOrderChanceDelta: 0,
        nonDebugAudioChanceDelta: 0,
      },
      acero: {
        audioRatioDelta: 0,
        weirdRatioDelta: 0,
        rudeRatioDelta: 0,
        duplicateChanceDelta: 0,
        outOfOrderChanceDelta: 0,
        nonDebugAudioChanceDelta: 0,
      },
    },
  };
}

function sanitizeAdaptiveProfile(input) {
  const base = defaultAdaptiveProfile();
  const fromInput = input && typeof input === 'object' ? input : {};
  const phaseAdjustments =
    fromInput.phaseAdjustments && typeof fromInput.phaseAdjustments === 'object'
      ? fromInput.phaseAdjustments
      : {};

  for (const phaseId of Object.keys(base.phaseAdjustments)) {
    const phaseDelta =
      phaseAdjustments[phaseId] && typeof phaseAdjustments[phaseId] === 'object'
        ? phaseAdjustments[phaseId]
        : {};
    base.phaseAdjustments[phaseId] = {
      audioRatioDelta: clamp(Number(phaseDelta.audioRatioDelta || 0), -0.35, 0.35),
      weirdRatioDelta: clamp(Number(phaseDelta.weirdRatioDelta || 0), -0.35, 0.35),
      rudeRatioDelta: clamp(Number(phaseDelta.rudeRatioDelta || 0), -0.35, 0.35),
      duplicateChanceDelta: clamp(Number(phaseDelta.duplicateChanceDelta || 0), -0.2, 0.2),
      outOfOrderChanceDelta: clamp(Number(phaseDelta.outOfOrderChanceDelta || 0), -0.2, 0.2),
      nonDebugAudioChanceDelta: clamp(Number(phaseDelta.nonDebugAudioChanceDelta || 0), -0.35, 0.35),
    };
  }

  base.updatedAt = fromInput.updatedAt || null;
  base.lastScore = Number.isFinite(Number(fromInput.lastScore)) ? Number(fromInput.lastScore) : null;
  return base;
}

const adaptiveProfile = ADAPTIVE_PROFILE_ENABLED
  ? sanitizeAdaptiveProfile(readJsonFile(ADAPTIVE_PROFILE_PATH, defaultAdaptiveProfile()))
  : defaultAdaptiveProfile();

const RAW_PHASES = [
  {
    id: 'normal',
    label: 'Pruebas normales',
    startMs: 0,
    endMs: 10 * 60 * 1000,
    baseRps: 0.12, // ~1 cliente cada 8-10s
    maxConcurrent: 6,
    audioRatio: 0.12,
    weirdRatio: 0.08,
    rudeRatio: 0.0,
    duplicateChance: 0.01,
    outOfOrderChance: 0.01,
    nonDebugAudioChance: 0.18,
    chaosLevel: 0.08,
  },
  {
    id: 'raras',
    label: 'Preguntas raras',
    startMs: 10 * 60 * 1000,
    endMs: 20 * 60 * 1000,
    baseRps: 0.45,
    maxConcurrent: 16,
    audioRatio: 0.25,
    weirdRatio: 0.45,
    rudeRatio: 0.08,
    duplicateChance: 0.02,
    outOfOrderChance: 0.02,
    nonDebugAudioChance: 0.24,
    chaosLevel: 0.15,
  },
  {
    id: 'desubicados',
    label: 'Mensajes desubicados',
    startMs: 20 * 60 * 1000,
    endMs: 30 * 60 * 1000,
    baseRps: 0.75,
    maxConcurrent: 28,
    audioRatio: 0.36,
    weirdRatio: 0.35,
    rudeRatio: 0.35,
    duplicateChance: 0.03,
    outOfOrderChance: 0.03,
    nonDebugAudioChance: 0.3,
    chaosLevel: 0.22,
  },
  {
    id: 'acero',
    label: 'Prueba de acero',
    startMs: 30 * 60 * 1000,
    endMs: 60 * 60 * 1000,
    baseRps: 2.2,
    peakRps: 8.5,
    maxConcurrent: 180,
    audioRatio: 0.58,
    weirdRatio: 0.52,
    rudeRatio: 0.28,
    duplicateChance: 0.08,
    outOfOrderChance: 0.08,
    nonDebugAudioChance: 0.42,
    chaosLevel: 0.4,
    burstChance: 0.35,
    burstMin: 5,
    burstMax: 30,
  },
];

const PHASES = RAW_PHASES.map(phase => ({
  ...phase,
  startMs: Math.max(0, Math.round(phase.startMs * PHASE_SCALE)),
  endMs: Math.max(1, Math.round(phase.endMs * PHASE_SCALE)),
  audioRatio: clamp(
    phase.audioRatio + (adaptiveProfile.phaseAdjustments[phase.id]?.audioRatioDelta || 0),
    0.01,
    0.95
  ),
  weirdRatio: clamp(
    phase.weirdRatio + (adaptiveProfile.phaseAdjustments[phase.id]?.weirdRatioDelta || 0),
    0,
    0.95
  ),
  rudeRatio: clamp(
    phase.rudeRatio + (adaptiveProfile.phaseAdjustments[phase.id]?.rudeRatioDelta || 0),
    0,
    0.95
  ),
  duplicateChance: clamp(
    phase.duplicateChance + (adaptiveProfile.phaseAdjustments[phase.id]?.duplicateChanceDelta || 0),
    0,
    0.3
  ),
  outOfOrderChance: clamp(
    phase.outOfOrderChance + (adaptiveProfile.phaseAdjustments[phase.id]?.outOfOrderChanceDelta || 0),
    0,
    0.3
  ),
  nonDebugAudioChance: clamp(
    phase.nonDebugAudioChance +
      (adaptiveProfile.phaseAdjustments[phase.id]?.nonDebugAudioChanceDelta || 0),
    0,
    0.95
  ),
}));

const NORMAL_SERVICES = [
  'corte',
  'recorte/tratamiento de barba',
  'perfilado de cejas',
];
const PAYMENT_METHODS = ['efectivo', 'transferencia', 'tarjeta'];
const CLIENT_NAMES = [
  'Fernando Vallejos',
  'Juan Perez',
  'Maria Lopez',
  'Sofia Acosta',
  'Pedro Ruiz',
  'Nadia Benitez',
  'Laura Diaz',
  'Carlos Gomez',
];
const WEIRD_QUESTIONS = [
  'si pido a las 4 pero en horario lunar cual seria?',
  'puedo ir martes no perdon jueves no mejor hoy',
  'si digo las 16 es 4 o 6?',
  'quiero turno para ayer pero confirmado manana',
  'si voy con mi primo y perro hay promo?',
  'me reservas un turno y despues vemos la fecha',
  'si te digo lo de siempre me entendes?',
  'turno para el mismo dia de recien pero mas temprano que tarde',
];
const RUDE_MESSAGES = [
  'dale apurate quiero turno ya',
  'no me hagas perder tiempo dame hora',
  'me estas mareando quiero corte ya',
  'contesta bien por favor que estoy apurado',
  'no entiendo nada decime una hora directa',
  'quiero resolver esto rapido sin vueltas',
];
const AUDIO_WEIRD_TRANSCRIPTS = [
  'manana no perdon el viernes a las 4',
  'quiero cancelar no perdon reprogramar',
  'las cuatro no las dieciseis no se',
  'ehhh este capaz martes',
  'quiero turno con barba no solo corte no se',
];
const AUDIO_UNINTELLIGIBLE = ['', 'mmm', 'ehhhh', 'ruido', '...'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function poisson(lambda) {
  if (lambda <= 0) return 0;
  const l = Math.exp(-lambda);
  let p = 1;
  let k = 0;
  do {
    k += 1;
    p *= Math.random();
  } while (p > l);
  return k - 1;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarizeLatencies(latencies) {
  if (!latencies.length) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  const total = latencies.reduce((acc, x) => acc + x, 0);
  return {
    min: Math.min(...latencies),
    max: Math.max(...latencies),
    avg: Number((total / latencies.length).toFixed(2)),
    p50: Number(percentile(latencies, 50).toFixed(2)),
    p95: Number(percentile(latencies, 95).toFixed(2)),
    p99: Number(percentile(latencies, 99).toFixed(2)),
  };
}

function formatMs(ms) {
  const sec = Math.floor(ms / 1000);
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function buildPhaseStats() {
  return {
    eventsTotal: 0,
    eventsOk: 0,
    eventsFailed: 0,
    eventsRecoveredAfterRetry: 0,
    eventsWithChaosFailure: 0,
    eventsFailedChaos: 0,
    eventsFailedNonChaos: 0,
    sent: 0,
    ok: 0,
    failures: 0,
    failuresChaos: 0,
    failuresNonChaos: 0,
    dropped: 0,
    retries: 0,
    textMessages: 0,
    audioMessages: 0,
    duplicatesSent: 0,
    outOfOrderSent: 0,
    latencies: [],
    statusHistogram: {},
    reasonCounts: {},
    audioReasonCounts: {},
  };
}

const state = {
  phase: PHASES[0],
  pending: new Set(),
  recentMessageIds: [],
  mediaStore: new Map(),
  clientFlowState: new Map(),
  totals: buildPhaseStats(),
  phases: Object.fromEntries(PHASES.map(p => [p.id, buildPhaseStats()])),
  maxPending: 0,
};

function trackRecentMessageId(messageId) {
  if (!messageId) return;
  state.recentMessageIds.push(messageId);
  if (state.recentMessageIds.length > 8000) {
    state.recentMessageIds.shift();
  }
}

function cleanupMediaStore() {
  const now = Date.now();
  for (const [mediaId, entry] of state.mediaStore.entries()) {
    if (!entry || now - entry.createdAt > 15 * 60 * 1000) {
      state.mediaStore.delete(mediaId);
    }
  }
  if (state.mediaStore.size <= 10000) return;
  const entries = [...state.mediaStore.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const extra = state.mediaStore.size - 10000;
  for (let i = 0; i < extra; i += 1) {
    state.mediaStore.delete(entries[i][0]);
  }
}

function computeSignature(rawBody) {
  return `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(rawBody)
    .digest('hex')}`;
}

function makeTextPayload({ from, id, timestamp, text }) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: from, profile: { name: `Cliente ${from.slice(-4)}` } }],
              messages: [
                {
                  from,
                  id,
                  timestamp,
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function makeAudioPayload({
  from,
  id,
  timestamp,
  mediaId,
  mimeType,
  durationSec,
  fileSize,
  debugTranscript,
  debugConfidence,
  debugFlags,
}) {
  const audio = {
    id: mediaId,
    mime_type: mimeType,
    file_size: fileSize,
    duration_sec: durationSec,
  };

  if (typeof debugTranscript === 'string') audio.debug_transcript = debugTranscript;
  if (Number.isFinite(debugConfidence)) audio.debug_confidence = debugConfidence;
  if (Array.isArray(debugFlags) && debugFlags.length) audio.debug_flags = debugFlags;

  return {
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: from, profile: { name: `Cliente ${from.slice(-4)}` } }],
              messages: [
                {
                  from,
                  id,
                  timestamp,
                  type: 'audio',
                  audio,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function buildFutureDate() {
  const d = new Date();
  d.setDate(d.getDate() + randomInt(1, 20));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function naturalHourVariant() {
  const variant = randomPick([
    'las 4',
    'a las 4',
    'las cuatro',
    'las 16',
    '16:00',
    '16 hs',
    'a las 16',
  ]);
  return variant;
}

function nextNormalTextForClient(clientId) {
  const current = state.clientFlowState.get(clientId) || { step: 0 };
  const step = current.step % 10;
  let text = 'hola';

  if (step === 0) text = randomPick(['hola', 'buenas']);
  if (step === 1) text = randomPick(['turno', 'quiero un turno']);
  if (step === 2) text = randomPick(NORMAL_SERVICES);
  if (step === 3) text = randomPick([buildFutureDate(), 'el martes que viene', 'para el jueves']);
  if (step === 4) text = naturalHourVariant();
  if (step === 5) text = randomPick(CLIENT_NAMES);
  if (step === 6) text = randomPick(PAYMENT_METHODS);
  if (step === 7) text = randomPick(['confirmar', 'confirmo']);
  if (step === 8) text = randomPick(['gracias', 'perfecto gracias']);
  if (step === 9) text = randomPick(['quiero otro turno', 'reprogramar mi turno porfa']);

  state.clientFlowState.set(clientId, { step: step + 1 });
  return text;
}

function buildTextMessage(clientId, phase) {
  const phaseStats = state.phases[phase.id];
  const pick = Math.random();
  let text = '';

  if (pick < phase.weirdRatio) {
    text = randomPick(WEIRD_QUESTIONS);
  } else if (pick < phase.weirdRatio + phase.rudeRatio) {
    text = randomPick(RUDE_MESSAGES);
  } else {
    text = nextNormalTextForClient(clientId);
  }

  phaseStats.textMessages += 1;
  state.totals.textMessages += 1;
  return text;
}

function buildDebugAudioProfile(phase) {
  const p = Math.random();
  if (p < 0.36) {
    return {
      transcript: randomPick(['turno', 'quiero turno para martes a las 4', 'corte para el jueves']),
      confidence: 0.92,
      flags: [],
      durationSec: randomInt(2, 9),
      mimeType: randomPick(['audio/ogg; codecs=opus', 'audio/ogg', 'application/octet-stream']),
    };
  }
  if (p < 0.64) {
    return {
      transcript: randomPick(AUDIO_WEIRD_TRANSCRIPTS),
      confidence: 0.58,
      flags: [],
      durationSec: randomInt(3, 12),
      mimeType: randomPick(['audio/ogg; codecs=opus', 'audio/mp4', 'audio/aac']),
    };
  }
  if (p < 0.82) {
    return {
      transcript: randomPick(AUDIO_UNINTELLIGIBLE),
      confidence: 0.28,
      flags: randomPick([['noise_only'], ['silence'], ['low_volume'], ['clipping']]),
      durationSec: randomInt(1, 6),
      mimeType: randomPick(['audio/ogg', 'audio/webm']),
    };
  }
  return {
    transcript: '',
    confidence: 0.1,
    flags: ['noise_only', 'abrupt_cut'],
    durationSec: 0.2,
    mimeType: randomPick(['audio/ogg', 'audio/mp4']),
  };
}

function registerMediaForNonDebug(mediaId, phase) {
  const chaosFactor = phase.chaosLevel;
  const modeRoll = Math.random();
  let mode = 'ok';
  if (modeRoll < 0.05 * chaosFactor * 3) mode = 'auth';
  else if (modeRoll < 0.10 * chaosFactor * 3) mode = 'not_found';
  else if (modeRoll < 0.18 * chaosFactor * 3) mode = 'timeout';
  else if (modeRoll < 0.24 * chaosFactor * 3) mode = 'stt_500';

  state.mediaStore.set(mediaId, {
    createdAt: Date.now(),
    mimeType: randomPick(['audio/ogg', 'audio/mp4', 'audio/mpeg']),
    transcript: randomPick([
      'quiero turno para el martes a las 4',
      'turno',
      'corte',
      'confirmar',
      'quiero cancelar turno',
    ]),
    mode,
  });
}

function buildAudioMessage({ from, phase, eventId, timestamp }) {
  const phaseStats = state.phases[phase.id];
  phaseStats.audioMessages += 1;
  state.totals.audioMessages += 1;

  const mediaId = `media-${eventId}`;
  const useNonDebug = Math.random() < phase.nonDebugAudioChance;
  const durationSec = randomInt(1, 20);
  const fileSize = clamp(durationSec * randomInt(4500, 11000), 4096, 6 * 1024 * 1024);

  if (useNonDebug) {
    registerMediaForNonDebug(mediaId, phase);
    return makeAudioPayload({
      from,
      id: eventId,
      timestamp,
      mediaId,
      mimeType: randomPick(['audio/ogg; codecs=opus', 'audio/mp4', 'audio/mpeg']),
      durationSec,
      fileSize,
    });
  }

  const profile = buildDebugAudioProfile(phase);
  return makeAudioPayload({
    from,
    id: eventId,
    timestamp,
    mediaId,
    mimeType: profile.mimeType,
    durationSec: profile.durationSec,
    fileSize,
    debugTranscript: profile.transcript,
    debugConfidence: profile.confidence,
    debugFlags: profile.flags,
  });
}

function choosePhase(elapsedMs) {
  const phase = PHASES.find(p => elapsedMs >= p.startMs && elapsedMs < p.endMs) || PHASES.at(-1);
  if (phase.id !== 'acero') return phase;

  const phaseElapsed = elapsedMs - phase.startMs;
  const phaseDuration = phase.endMs - phase.startMs;
  const ratio = clamp(phaseElapsed / phaseDuration, 0, 1);
  const dynamicRps = phase.baseRps + (phase.peakRps - phase.baseRps) * ratio;
  return {
    ...phase,
    currentRps: dynamicRps,
  };
}

function applyTimestampChaos(baseTsSec, phase) {
  if (Math.random() < phase.outOfOrderChance) {
    return String(baseTsSec - randomInt(30, 180));
  }
  return String(baseTsSec);
}

function maybeUseDuplicateId(phase) {
  if (!state.recentMessageIds.length) return null;
  if (Math.random() >= phase.duplicateChance) return null;
  const duplicateId = randomPick(state.recentMessageIds);
  state.phases[phase.id].duplicatesSent += 1;
  state.totals.duplicatesSent += 1;
  return duplicateId;
}

function buildInboundEvent(phase, index) {
  const userIndex =
    phase.id === 'normal'
      ? randomInt(0, Math.min(80, USER_POOL_SIZE - 1))
      : randomInt(0, USER_POOL_SIZE - 1);
  const from = `5959${String(70000000 + userIndex).padStart(8, '0')}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const duplicateId = maybeUseDuplicateId(phase);
  const eventId =
    duplicateId || `soak-${phase.id}-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`;
  const ts = applyTimestampChaos(nowSec, phase);
  if (ts !== String(nowSec)) {
    state.phases[phase.id].outOfOrderSent += 1;
    state.totals.outOfOrderSent += 1;
  }

  const isAudio = Math.random() < phase.audioRatio;
  if (isAudio) {
    return {
      from,
      messageId: eventId,
      payload: buildAudioMessage({
        from,
        phase,
        eventId,
        timestamp: ts,
      }),
    };
  }

  const text = buildTextMessage(from, phase);
  return {
    from,
    messageId: eventId,
    payload: makeTextPayload({
      from,
      id: eventId,
      timestamp: ts,
      text,
    }),
  };
}

function incrementHistogram(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function isChaosFailurePayload(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return text.includes('simulated');
}

function isChaosFailureError(error) {
  const text = String(error?.message || '').toLowerCase();
  return text.includes('simulated');
}

function createFetchMock() {
  return async function fetchMock(url, opts = {}) {
    const target = String(url || '');
    const phase = state.phase || PHASES[0];
    const chaos = phase.chaosLevel || 0;

    if (target.includes('/messages')) {
      const r = Math.random();
      if (r < 0.02 + chaos * 0.05) {
        await sleep(randomInt(250, 900));
        return {
          ok: false,
          status: 500,
          text: async () => '{"error":{"message":"simulated outbound 500"}}',
          json: async () => ({ error: { message: 'simulated outbound 500' } }),
        };
      }
      if (r < 0.04 + chaos * 0.09) {
        await sleep(randomInt(900, 1800));
        const err = new Error('simulated outbound timeout');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      await sleep(randomInt(15, 120));
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: `wamid.soak.out.${Date.now()}` }] }),
        text: async () => '',
      };
    }

    if (target.includes('graph.facebook.com') && (opts.method || 'GET') === 'GET') {
      const m = target.match(/\/v\d+\.\d+\/([^/?]+)/i);
      const mediaId = m ? m[1] : '';
      const media = state.mediaStore.get(mediaId);
      if (!media) {
        return {
          ok: false,
          status: 404,
          text: async () => '{"error":{"message":"simulated media not found"}}',
          json: async () => ({ error: { message: 'simulated media not found' } }),
        };
      }
      if (media.mode === 'auth') {
        return {
          ok: false,
          status: 401,
          text: async () => '{"error":{"message":"simulated media auth error"}}',
          json: async () => ({ error: { message: 'simulated media auth error' } }),
        };
      }
      if (media.mode === 'not_found') {
        return {
          ok: false,
          status: 404,
          text: async () => '{"error":{"message":"simulated media url missing"}}',
          json: async () => ({ error: { message: 'simulated media url missing' } }),
        };
      }
      if (media.mode === 'timeout') {
        await sleep(randomInt(1100, 2200));
        const err = new Error('simulated metadata timeout');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: `https://lookaside.whatsapp.test/${mediaId}`,
          mime_type: media.mimeType || 'audio/ogg',
        }),
        text: async () => '',
      };
    }

    if (target.includes('lookaside.whatsapp.test')) {
      const mediaId = target.split('/').pop();
      const media = state.mediaStore.get(mediaId);
      if (!media) {
        return {
          ok: false,
          status: 404,
          text: async () => '{"error":{"message":"simulated lookaside missing"}}',
          json: async () => ({ error: { message: 'simulated lookaside missing' } }),
        };
      }
      if (media.mode === 'timeout') {
        await sleep(randomInt(1100, 2200));
        const err = new Error('simulated download timeout');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      if (media.mode === 'not_found') {
        return {
          ok: false,
          status: 404,
          text: async () => '{"error":{"message":"simulated lookaside expired"}}',
          json: async () => ({ error: { message: 'simulated lookaside expired' } }),
        };
      }
      const bytes = Buffer.from(`audio-${mediaId}`);
      return {
        ok: true,
        status: 200,
        headers: {
          get: key => {
            if (String(key || '').toLowerCase() === 'content-type') {
              return media.mimeType || 'audio/ogg';
            }
            return null;
          },
        },
        arrayBuffer: async () => bytes,
        text: async () => '',
        json: async () => ({}),
      };
    }

    if (target.includes('/audio/transcriptions')) {
      const r = Math.random();
      if (r < 0.03 + chaos * 0.06) {
        return {
          ok: false,
          status: 500,
          text: async () => '{"error":{"message":"stt intermittent 500"}}',
          json: async () => ({ error: { message: 'stt intermittent 500' } }),
        };
      }
      if (r < 0.04 + chaos * 0.08) {
        return {
          ok: false,
          status: 401,
          text: async () => '{"error":{"message":"simulated stt unauthorized"}}',
          json: async () => ({ error: { message: 'simulated stt unauthorized' } }),
        };
      }
      await sleep(randomInt(50, 220));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: randomPick([
            'turno',
            'quiero turno para martes a las 4',
            'confirmar',
            'reprogramar mi turno',
            'cancelar turno',
          ]),
        }),
        text: async () => '',
      };
    }

    return {
      ok: false,
      status: 500,
      text: async () => '{"error":{"message":"simulated unexpected fetch url"}}',
      json: async () => ({ error: { message: 'simulated unexpected fetch url' } }),
    };
  };
}

async function dispatchEvent(event, phase, seq) {
  const phaseStats = state.phases[phase.id];
  const raw = JSON.stringify(event.payload);
  const signature = computeSignature(raw);
  trackRecentMessageId(event.messageId);

  phaseStats.eventsTotal += 1;
  state.totals.eventsTotal += 1;

  const attemptLimit = 3;
  let attempt = 0;
  let eventHadFailure = false;
  let eventHadChaosFailure = false;
  let finalFailureWasChaos = false;
  let eventSucceeded = false;

  while (attempt < attemptLimit) {
    attempt += 1;
    const startedAt = Date.now();
    try {
      const forwardedFor = `10.91.${seq % 250}.${(seq * 13 + attempt) % 250}`;
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', forwardedFor)
        .set('x-hub-signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(raw);

      const latency = Date.now() - startedAt;
      phaseStats.sent += 1;
      phaseStats.latencies.push(latency);
      state.totals.sent += 1;
      state.totals.latencies.push(latency);
      incrementHistogram(phaseStats.statusHistogram, String(res.statusCode));
      incrementHistogram(state.totals.statusHistogram, String(res.statusCode));

      const genericReason = res.body?.reason;
      const audioReason = res.body?.audio?.reason;
      if (genericReason) {
        incrementHistogram(phaseStats.reasonCounts, genericReason);
        incrementHistogram(state.totals.reasonCounts, genericReason);
      }
      if (audioReason) {
        incrementHistogram(phaseStats.audioReasonCounts, audioReason);
        incrementHistogram(state.totals.audioReasonCounts, audioReason);
      }

      if (res.statusCode >= 500 || res.body?.ok === false) {
        eventHadFailure = true;
        const chaosFailure = isChaosFailurePayload(res.body);
        finalFailureWasChaos = chaosFailure;

        phaseStats.failures += 1;
        state.totals.failures += 1;
        if (chaosFailure) {
          phaseStats.failuresChaos += 1;
          state.totals.failuresChaos += 1;
          eventHadChaosFailure = true;
        } else {
          phaseStats.failuresNonChaos += 1;
          state.totals.failuresNonChaos += 1;
        }
        if (attempt < attemptLimit) {
          phaseStats.retries += 1;
          state.totals.retries += 1;
          await sleep(80 * 2 ** (attempt - 1));
          continue;
        }
      } else {
        phaseStats.ok += 1;
        state.totals.ok += 1;
        phaseStats.eventsOk += 1;
        state.totals.eventsOk += 1;
        if (eventHadFailure) {
          phaseStats.eventsRecoveredAfterRetry += 1;
          state.totals.eventsRecoveredAfterRetry += 1;
        }
        if (eventHadChaosFailure) {
          phaseStats.eventsWithChaosFailure += 1;
          state.totals.eventsWithChaosFailure += 1;
        }
        eventSucceeded = true;
      }
      break;
    } catch (_err) {
      const latency = Date.now() - startedAt;
      phaseStats.sent += 1;
      phaseStats.failures += 1;
      phaseStats.latencies.push(latency);
      state.totals.sent += 1;
      state.totals.failures += 1;
      state.totals.latencies.push(latency);
      incrementHistogram(phaseStats.statusHistogram, 'exception');
      incrementHistogram(state.totals.statusHistogram, 'exception');

      eventHadFailure = true;
      const chaosFailure = isChaosFailureError(_err);
      finalFailureWasChaos = chaosFailure;
      if (chaosFailure) {
        phaseStats.failuresChaos += 1;
        state.totals.failuresChaos += 1;
        eventHadChaosFailure = true;
      } else {
        phaseStats.failuresNonChaos += 1;
        state.totals.failuresNonChaos += 1;
      }

      if (attempt < attemptLimit) {
        phaseStats.retries += 1;
        state.totals.retries += 1;
        await sleep(80 * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
  }

  if (!eventSucceeded) {
    phaseStats.eventsFailed += 1;
    state.totals.eventsFailed += 1;
    if (eventHadChaosFailure) {
      phaseStats.eventsWithChaosFailure += 1;
      state.totals.eventsWithChaosFailure += 1;
    }
    if (finalFailureWasChaos) {
      phaseStats.eventsFailedChaos += 1;
      state.totals.eventsFailedChaos += 1;
    } else {
      phaseStats.eventsFailedNonChaos += 1;
      state.totals.eventsFailedNonChaos += 1;
    }
  }
}

function buildReport(durationElapsedMs) {
  const phaseReports = PHASES.map(phase => {
    const s = state.phases[phase.id];
    return {
      id: phase.id,
      label: phase.label,
      eventsTotal: s.eventsTotal,
      eventsOk: s.eventsOk,
      eventsFailed: s.eventsFailed,
      eventsRecoveredAfterRetry: s.eventsRecoveredAfterRetry,
      eventsWithChaosFailure: s.eventsWithChaosFailure,
      eventsFailedChaos: s.eventsFailedChaos,
      eventsFailedNonChaos: s.eventsFailedNonChaos,
      sent: s.sent,
      ok: s.ok,
      failures: s.failures,
      failuresChaos: s.failuresChaos,
      failuresNonChaos: s.failuresNonChaos,
      dropped: s.dropped,
      retries: s.retries,
      textMessages: s.textMessages,
      audioMessages: s.audioMessages,
      duplicatesSent: s.duplicatesSent,
      outOfOrderSent: s.outOfOrderSent,
      latencyMs: summarizeLatencies(s.latencies),
      statusHistogram: s.statusHistogram,
      reasonCounts: s.reasonCounts,
      audioReasonCounts: s.audioReasonCounts,
      eventFailureRatePercent: toPercent(s.eventsFailed, s.eventsTotal),
      adjustedEventFailureRatePercent: toPercent(s.eventsFailedNonChaos, s.eventsTotal),
      attemptFailureRatePercent: toPercent(s.failures, s.sent),
      nonChaosAttemptFailureRatePercent: toPercent(s.failuresNonChaos, s.sent),
      chaosAttemptFailureRatePercent: toPercent(s.failuresChaos, s.sent),
    };
  });

  const totals = state.totals;
  const report = {
    generatedAt: new Date().toISOString(),
    phaseScale: PHASE_SCALE,
    configuredDurationMs: DURATION_MS,
    elapsedMs: durationElapsedMs,
    maxPending: state.maxPending,
    total: {
      eventsTotal: totals.eventsTotal,
      eventsOk: totals.eventsOk,
      eventsFailed: totals.eventsFailed,
      eventsRecoveredAfterRetry: totals.eventsRecoveredAfterRetry,
      eventsWithChaosFailure: totals.eventsWithChaosFailure,
      eventsFailedChaos: totals.eventsFailedChaos,
      eventsFailedNonChaos: totals.eventsFailedNonChaos,
      sent: totals.sent,
      ok: totals.ok,
      failures: totals.failures,
      failuresChaos: totals.failuresChaos,
      failuresNonChaos: totals.failuresNonChaos,
      dropped: totals.dropped,
      retries: totals.retries,
      textMessages: totals.textMessages,
      audioMessages: totals.audioMessages,
      duplicatesSent: totals.duplicatesSent,
      outOfOrderSent: totals.outOfOrderSent,
      errorRatePercent: totals.sent ? Number(((totals.failures / totals.sent) * 100).toFixed(2)) : 0,
      nonChaosAttemptFailureRatePercent: toPercent(totals.failuresNonChaos, totals.sent),
      chaosAttemptFailureRatePercent: toPercent(totals.failuresChaos, totals.sent),
      retryRatioPercent: totals.sent ? Number(((totals.retries / totals.sent) * 100).toFixed(2)) : 0,
      eventFailureRatePercent: toPercent(totals.eventsFailed, totals.eventsTotal),
      adjustedEventFailureRatePercent: toPercent(
        totals.eventsFailedNonChaos,
        totals.eventsTotal
      ),
      throughputReqPerSec: durationElapsedMs
        ? Number(((totals.sent / durationElapsedMs) * 1000).toFixed(2))
        : 0,
      latencyMs: summarizeLatencies(totals.latencies),
      statusHistogram: totals.statusHistogram,
      reasonCounts: totals.reasonCounts,
      audioReasonCounts: totals.audioReasonCounts,
    },
    phases: phaseReports,
  };

  return report;
}

function buildHistoryEntry(report, diagnostic) {
  const total = report.total || {};
  return {
    generatedAt: report.generatedAt,
    score: diagnostic.score,
    grade: diagnostic.grade,
    sent: total.sent || 0,
    ok: total.ok || 0,
    failures: total.failures || 0,
    dropped: total.dropped || 0,
    retries: total.retries || 0,
    errorRatePercent: total.errorRatePercent || 0,
    retryRatioPercent: total.retryRatioPercent || 0,
    adjustedEventFailureRatePercent: total.adjustedEventFailureRatePercent || 0,
    dropRatePercent: diagnostic.metrics.dropRatePercent || 0,
    fiveXxPercent: diagnostic.metrics.fiveXxPercent || 0,
    p95Ms: total.latencyMs?.p95 || 0,
    p99Ms: total.latencyMs?.p99 || 0,
    audioFailurePercent: diagnostic.metrics.audioFailurePercent || 0,
    phaseCoveragePercent: diagnostic.metrics.phaseCoveragePercent || 0,
    topStatuses: topHistogram(total.statusHistogram || {}, 4),
    topReasons: topHistogram(total.reasonCounts || {}, 4),
    topAudioReasons: topHistogram(total.audioReasonCounts || {}, 4),
  };
}

function gradeForScore(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 55) return 'D';
  return 'E';
}

function deriveDiagnostic(report, previousRun) {
  const total = report.total || {};
  const statusHistogram = total.statusHistogram || {};
  const reasonCounts = total.reasonCounts || {};
  const audioReasonCounts = total.audioReasonCounts || {};
  const totalStatuses = sumHistogram(statusHistogram);
  const rawAttemptErrorRate = Number(total.errorRatePercent || 0);
  const effectiveErrorRate = Number(
    total.adjustedEventFailureRatePercent ??
      total.nonChaosAttemptFailureRatePercent ??
      total.errorRatePercent ??
      0
  );

  const fiveXx = Object.entries(statusHistogram).reduce((acc, [code, count]) => {
    const codeNumber = Number(code);
    if (Number.isFinite(codeNumber) && codeNumber >= 500 && codeNumber < 600) {
      return acc + Number(count || 0);
    }
    return acc;
  }, 0);
  const exceptions = Number(statusHistogram.exception || 0);
  const dropRatePercent = toPercent(total.dropped || 0, total.sent || 0);
  const fiveXxPercent = toPercent(fiveXx + exceptions, totalStatuses || total.sent || 0);
  const audioFailureKeys = [
    'audio_unsupported_mime',
    'media_timeout',
    'media_auth_error',
    'media_not_found',
    'media_download_failed',
    'stt_auth_error',
    'stt_rate_limited',
    'stt_timeout',
    'stt_provider_error',
    'stt_failed',
  ];
  const audioFailureCount = audioFailureKeys.reduce(
    (acc, key) => acc + Number(audioReasonCounts[key] || 0),
    0
  );
  const audioFailurePercent = toPercent(audioFailureCount, total.audioMessages || 0);
  const phaseCoveragePercent = toPercent(
    report.phases.filter(p => p.sent >= TARGETS.coverageMinSentPerPhase).length,
    report.phases.length
  );

  const strengths = [];
  const weaknesses = [];
  const recommendations = [];

  if (effectiveErrorRate <= TARGETS.errorRatePercent) {
    strengths.push('Error rate dentro de objetivo');
  } else {
    weaknesses.push({
      severity: 'high',
      area: 'stability',
      title: 'Error rate alto',
      metric: 'adjustedEventFailureRatePercent',
      value: effectiveErrorRate,
      target: TARGETS.errorRatePercent,
    });
    recommendations.push({
      priority: 'P0',
      area: 'stability',
      title: 'Bajar error rate global',
      why: `Error rate ajustado ${effectiveErrorRate}% > ${TARGETS.errorRatePercent}%`,
      action:
        'Analizar top status/reasons del reporte y corregir primero las 2 causas con mayor frecuencia.',
      verifyWith: 'Re-ejecutar load:soak:1h y validar errorRate <= 1%.',
    });
  }

  const chaosGap = round2(rawAttemptErrorRate - effectiveErrorRate);
  if (chaosGap > 1) {
    strengths.push(
      `Resistencia al caos: ${chaosGap}% del error bruto proviene de fallas inyectadas controladas`
    );
  }

  if (dropRatePercent <= TARGETS.dropRatePercent) {
    strengths.push('Backpressure controlado (dropped bajo)');
  } else {
    weaknesses.push({
      severity: 'high',
      area: 'capacity',
      title: 'Demasiados eventos descartados por concurrencia',
      metric: 'dropRatePercent',
      value: dropRatePercent,
      target: TARGETS.dropRatePercent,
    });
    recommendations.push({
      priority: 'P0',
      area: 'capacity',
      title: 'Reducir drops en picos',
      why: `dropRate ${dropRatePercent}% excede objetivo ${TARGETS.dropRatePercent}%`,
      action:
        'Ajustar cola/buffer, maxConcurrent por fase y tiempos de procesamiento del webhook/audio.',
      verifyWith: 'Validar dropRate <= 1% bajo fase acero.',
    });
  }

  if ((total.latencyMs?.p95 || 0) <= TARGETS.p95LatencyMs) {
    strengths.push('Latencia p95 dentro de objetivo');
  } else {
    weaknesses.push({
      severity: 'medium',
      area: 'performance',
      title: 'Latencia p95 elevada',
      metric: 'latencyP95Ms',
      value: total.latencyMs?.p95 || 0,
      target: TARGETS.p95LatencyMs,
    });
    recommendations.push({
      priority: 'P1',
      area: 'performance',
      title: 'Optimizar ruta /meta-webhook en carga',
      why: `p95 ${total.latencyMs?.p95 || 0}ms > ${TARGETS.p95LatencyMs}ms`,
      action: 'Perfilar parseo, IO de DB y pipeline STT; cachear lookups repetidos.',
      verifyWith: 'p95 <= 1200ms y p99 <= 3000ms.',
    });
  }

  if ((total.retryRatioPercent || 0) > TARGETS.retryRatioPercent) {
    weaknesses.push({
      severity: 'medium',
      area: 'resilience',
      title: 'Retry ratio alto',
      metric: 'retryRatioPercent',
      value: total.retryRatioPercent || 0,
      target: TARGETS.retryRatioPercent,
    });
    recommendations.push({
      priority: 'P1',
      area: 'resilience',
      title: 'Reducir retries innecesarios',
      why: `retry ratio ${total.retryRatioPercent || 0}% > ${TARGETS.retryRatioPercent}%`,
      action: 'Revisar timeouts y errores recuperables/no recuperables en STT y media download.',
      verifyWith: 'retry ratio <= 5% sostenido.',
    });
  } else {
    strengths.push('Retry ratio controlado');
  }

  if ((total.nonChaosAttemptFailureRatePercent || 0) > TARGETS.fiveXxPercent) {
    weaknesses.push({
      severity: 'high',
      area: 'server',
      title: 'Exceso de errores no-caos en webhook',
      metric: 'nonChaosAttemptFailureRatePercent',
      value: total.nonChaosAttemptFailureRatePercent || 0,
      target: TARGETS.fiveXxPercent,
    });
    recommendations.push({
      priority: 'P0',
      area: 'server',
      title: 'Eliminar errores internos en webhook',
      why: `errores no-caos ${total.nonChaosAttemptFailureRatePercent || 0}%`,
      action: 'Inspeccionar stack traces de las rutas con mayor frecuencia de 500/exception.',
      verifyWith: '5xx+exception < 0.5% por corrida.',
    });
  }

  if (audioFailurePercent > TARGETS.audioFailurePercent) {
    weaknesses.push({
      severity: 'medium',
      area: 'audio',
      title: 'Pipeline de audio inestable',
      metric: 'audioFailurePercent',
      value: audioFailurePercent,
      target: TARGETS.audioFailurePercent,
    });
    recommendations.push({
      priority: 'P1',
      area: 'audio',
      title: 'Fortalecer manejo de audio dificil',
      why: `audio failures ${audioFailurePercent}% > ${TARGETS.audioFailurePercent}%`,
      action:
        'Ajustar retries/media timeout y forzar aclaracion temprana cuando confidence sea baja.',
      verifyWith: 'audio failure <= 8% en fase acero.',
    });
  } else if ((total.audioMessages || 0) > 0) {
    strengths.push('Audio con tasa de fallas aceptable');
  }

  if (phaseCoveragePercent < 100) {
    const uncovered = report.phases.filter(p => p.sent < TARGETS.coverageMinSentPerPhase).map(p => p.id);
    weaknesses.push({
      severity: 'medium',
      area: 'testing',
      title: 'Cobertura baja en una o mas fases',
      metric: 'phaseCoveragePercent',
      value: phaseCoveragePercent,
      target: 100,
      details: `Fases con baja muestra: ${uncovered.join(', ')}`,
    });
    recommendations.push({
      priority: 'P2',
      area: 'testing',
      title: 'Subir volumen minimo por fase',
      why: `Cobertura de fases ${phaseCoveragePercent}%`,
      action:
        'Incrementar SOAK_DURATION_MS o SOAK_PHASE_SCALE para obtener al menos 50 eventos por fase.',
      verifyWith: 'Todas las fases con >= 50 eventos.',
    });
  } else {
    strengths.push('Cobertura de fases completa');
  }

  if ((total.duplicatesSent || 0) > 0 && Number(reasonCounts.duplicate_event || 0) > 0) {
    strengths.push('Idempotencia observada en eventos duplicados');
  }

  const penalties =
    Math.max(0, effectiveErrorRate - TARGETS.errorRatePercent) * 4 +
    Math.max(0, dropRatePercent - TARGETS.dropRatePercent) * 2 +
    Math.max(0, (total.nonChaosAttemptFailureRatePercent || 0) - TARGETS.fiveXxPercent) * 5 +
    Math.max(0, ((total.latencyMs?.p95 || 0) - TARGETS.p95LatencyMs) / 100) +
    Math.max(0, ((total.latencyMs?.p99 || 0) - TARGETS.p99LatencyMs) / 250) +
    Math.max(0, (total.retryRatioPercent || 0) - TARGETS.retryRatioPercent) * 1.25 +
    Math.max(0, audioFailurePercent - TARGETS.audioFailurePercent) * 1.5;
  const score = round2(clamp(100 - penalties, 0, 100));
  const grade = gradeForScore(score);

  const trend = previousRun
    ? {
        previousGeneratedAt: previousRun.generatedAt,
        scoreDelta: round2(score - Number(previousRun.score || 0)),
        errorRateDelta: round2(
          effectiveErrorRate - Number(previousRun.adjustedEventFailureRatePercent || 0)
        ),
        p95DeltaMs: round2((total.latencyMs?.p95 || 0) - Number(previousRun.p95Ms || 0)),
        dropRateDelta: round2(dropRatePercent - Number(previousRun.dropRatePercent || 0)),
      }
    : null;

  recommendations.sort((a, b) => a.priority.localeCompare(b.priority));

  return {
    score,
    grade,
    strengths,
    weaknesses,
    recommendations,
    metrics: {
      rawAttemptErrorRatePercent: rawAttemptErrorRate,
      adjustedEventFailureRatePercent: effectiveErrorRate,
      dropRatePercent,
      fiveXxPercent,
      audioFailurePercent,
      phaseCoveragePercent,
    },
    topFailures: {
      statuses: topHistogram(statusHistogram, 6),
      reasons: topHistogram(reasonCounts, 6),
      audioReasons: topHistogram(audioReasonCounts, 8),
    },
    trend,
  };
}

function decayDelta(delta, factor = 0.9) {
  return round2(delta * factor);
}

function buildNextAdaptiveProfile(report, diagnostic) {
  const next = sanitizeAdaptiveProfile(adaptiveProfile);
  const targetPhases = ['raras', 'desubicados', 'acero'];

  for (const phaseId of Object.keys(next.phaseAdjustments)) {
    const entry = next.phaseAdjustments[phaseId];
    entry.audioRatioDelta = decayDelta(entry.audioRatioDelta);
    entry.weirdRatioDelta = decayDelta(entry.weirdRatioDelta);
    entry.rudeRatioDelta = decayDelta(entry.rudeRatioDelta);
    entry.duplicateChanceDelta = decayDelta(entry.duplicateChanceDelta);
    entry.outOfOrderChanceDelta = decayDelta(entry.outOfOrderChanceDelta);
    entry.nonDebugAudioChanceDelta = decayDelta(entry.nonDebugAudioChanceDelta);
  }

  const metrics = diagnostic.metrics || {};
  if ((metrics.audioFailurePercent || 0) > TARGETS.audioFailurePercent) {
    for (const phaseId of targetPhases) {
      next.phaseAdjustments[phaseId].audioRatioDelta = clamp(
        next.phaseAdjustments[phaseId].audioRatioDelta + 0.04,
        -0.35,
        0.35
      );
      next.phaseAdjustments[phaseId].nonDebugAudioChanceDelta = clamp(
        next.phaseAdjustments[phaseId].nonDebugAudioChanceDelta + 0.05,
        -0.35,
        0.35
      );
    }
  }

  if ((metrics.fiveXxPercent || 0) > TARGETS.fiveXxPercent) {
    for (const phaseId of ['desubicados', 'acero']) {
      next.phaseAdjustments[phaseId].duplicateChanceDelta = clamp(
        next.phaseAdjustments[phaseId].duplicateChanceDelta + 0.01,
        -0.2,
        0.2
      );
      next.phaseAdjustments[phaseId].outOfOrderChanceDelta = clamp(
        next.phaseAdjustments[phaseId].outOfOrderChanceDelta + 0.01,
        -0.2,
        0.2
      );
    }
  }

  if ((report.total?.adjustedEventFailureRatePercent || 0) > TARGETS.errorRatePercent) {
    next.phaseAdjustments.raras.weirdRatioDelta = clamp(
      next.phaseAdjustments.raras.weirdRatioDelta + 0.02,
      -0.35,
      0.35
    );
    next.phaseAdjustments.desubicados.rudeRatioDelta = clamp(
      next.phaseAdjustments.desubicados.rudeRatioDelta + 0.02,
      -0.35,
      0.35
    );
  }

  next.updatedAt = new Date().toISOString();
  next.lastScore = diagnostic.score;
  return next;
}

function buildNextActions(report, diagnostic, nextAdaptive) {
  return {
    generatedAt: report.generatedAt,
    score: diagnostic.score,
    grade: diagnostic.grade,
    summary: `Score ${diagnostic.score}/100 (${diagnostic.grade})`,
    priorities: diagnostic.recommendations,
    topFailures: diagnostic.topFailures,
    nextRunAdaptiveProfile: nextAdaptive,
    runCommands: [
      'cd backend',
      'npm run load:soak:1h',
      'npm run test:reliability',
      'npm run test:audio',
    ],
  };
}

function writeReport(report) {
  ensureReportsDir();
  const jsonPath = path.join(REPORTS_DIR, 'bot-soak-1h.latest.json');
  const mdPath = path.join(REPORTS_DIR, 'bot-soak-1h.latest.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const diagnostic = report.diagnostic || {};
  const trend = diagnostic.trend;
  const lines = [
    '# Bot Soak Test (1h)',
    '',
    `Generated: ${report.generatedAt}`,
    `Configured duration: ${formatMs(report.configuredDurationMs)}`,
    `Elapsed: ${formatMs(report.elapsedMs)}`,
    `Adaptive profile enabled: ${report.adaptive?.enabled ? 'yes' : 'no'}`,
    '',
    '## Verdict',
    `- Score: ${diagnostic.score ?? 0}/100`,
    `- Grade: ${diagnostic.grade ?? 'N/A'}`,
    `- Max pending: ${report.maxPending}`,
    `- Phase coverage: ${diagnostic.metrics?.phaseCoveragePercent ?? 0}%`,
    '',
    '## Total',
    `- Sent: ${report.total.sent}`,
    `- OK: ${report.total.ok}`,
    `- Failures: ${report.total.failures}`,
    `- Failures (chaos/non-chaos): ${report.total.failuresChaos}/${report.total.failuresNonChaos}`,
    `- Dropped (backpressure): ${report.total.dropped}`,
    `- Retries: ${report.total.retries}`,
    `- Error rate (attempt): ${report.total.errorRatePercent}%`,
    `- Error rate (event): ${report.total.eventFailureRatePercent}%`,
    `- Error rate (event adjusted non-chaos): ${report.total.adjustedEventFailureRatePercent}%`,
    `- Retry ratio: ${report.total.retryRatioPercent}%`,
    `- Throughput: ${report.total.throughputReqPerSec} req/s`,
    `- Latency p50/p95/p99: ${report.total.latencyMs.p50} / ${report.total.latencyMs.p95} / ${report.total.latencyMs.p99} ms`,
    `- Drop rate: ${diagnostic.metrics?.dropRatePercent ?? 0}%`,
    `- 5xx+exception: ${diagnostic.metrics?.fiveXxPercent ?? 0}%`,
    `- Audio failure rate: ${diagnostic.metrics?.audioFailurePercent ?? 0}%`,
    '',
    '## Strengths',
  ];

  if (diagnostic.strengths?.length) {
    for (const item of diagnostic.strengths) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('- No clear strengths detected in this run.');
  }

  lines.push('', '## Weaknesses');
  if (diagnostic.weaknesses?.length) {
    for (const weakness of diagnostic.weaknesses) {
      lines.push(
        `- [${weakness.severity}] ${weakness.title} (${weakness.metric}: ${weakness.value} target=${weakness.target})`
      );
      if (weakness.details) lines.push(`  details: ${weakness.details}`);
    }
  } else {
    lines.push('- No critical weakness detected.');
  }

  lines.push('', '## Recommendations');
  if (diagnostic.recommendations?.length) {
    for (const rec of diagnostic.recommendations) {
      lines.push(`- [${rec.priority}] ${rec.title} [${rec.area}]`);
      lines.push(`  why: ${rec.why}`);
      lines.push(`  action: ${rec.action}`);
      lines.push(`  verify: ${rec.verifyWith}`);
    }
  } else {
    lines.push('- Keep current configuration and rerun to confirm stability.');
  }

  lines.push('', '## Top Failure Signals');
  for (const statusEntry of diagnostic.topFailures?.statuses || []) {
    lines.push(`- status ${statusEntry.key}: ${statusEntry.count}`);
  }
  for (const reasonEntry of diagnostic.topFailures?.reasons || []) {
    lines.push(`- reason ${reasonEntry.key}: ${reasonEntry.count}`);
  }
  for (const audioEntry of diagnostic.topFailures?.audioReasons || []) {
    lines.push(`- audio reason ${audioEntry.key}: ${audioEntry.count}`);
  }

  lines.push('', '## Trend');
  if (trend) {
    lines.push(`- Previous run: ${trend.previousGeneratedAt}`);
    lines.push(`- Score delta: ${trend.scoreDelta}`);
    lines.push(`- Error rate delta: ${trend.errorRateDelta}`);
    lines.push(`- p95 delta (ms): ${trend.p95DeltaMs}`);
    lines.push(`- Drop rate delta: ${trend.dropRateDelta}`);
  } else {
    lines.push('- No previous run available for comparison.');
  }

  lines.push('', '## Phases');
  for (const phase of report.phases) {
    lines.push(
      `### ${phase.label} (${phase.id})`,
      `- Sent: ${phase.sent}`,
      `- OK/Fail: ${phase.ok}/${phase.failures}`,
      `- Dropped: ${phase.dropped}`,
      `- Text/Audio: ${phase.textMessages}/${phase.audioMessages}`,
      `- Retries: ${phase.retries}`,
      `- Latency p50/p95/p99: ${phase.latencyMs.p50}/${phase.latencyMs.p95}/${phase.latencyMs.p99} ms`,
      ''
    );
  }

  lines.push('## Evolution Artifacts');
  lines.push(`- History: ${HISTORY_PATH}`);
  lines.push(`- Adaptive profile: ${ADAPTIVE_PROFILE_PATH}`);
  lines.push(`- Next actions: ${NEXT_ACTIONS_PATH}`);
  lines.push(`JSON report: ${jsonPath}`);
  fs.writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath };
}

async function main() {
  global.fetch = createFetchMock();
  const users = Array.from({ length: USER_POOL_SIZE }).map((_, i) => i);
  const historyData = readJsonFile(HISTORY_PATH, { version: 1, runs: [] });
  const historyRuns = Array.isArray(historyData.runs) ? historyData.runs : [];
  const previousRun = historyRuns.length ? historyRuns[historyRuns.length - 1] : null;

  console.log(
    `Iniciando soak test de ${formatMs(DURATION_MS)} con tick=${TICK_MS}ms pool=${USER_POOL_SIZE} phaseScale=${PHASE_SCALE}...`
  );
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let seq = 0;

  while (Date.now() - startedAt < DURATION_MS) {
    const elapsed = Date.now() - startedAt;
    const phase = choosePhase(elapsed);
    state.phase = phase;

    cleanupMediaStore();

    const rps = Number((phase.currentRps || phase.baseRps).toFixed(3));
    let toSend = poisson(rps * (TICK_MS / 1000));
    if (phase.id === 'normal' && Math.random() < 0.3) {
      toSend = Math.max(1, toSend);
    }
    if (phase.id === 'acero' && phase.burstChance && Math.random() < phase.burstChance) {
      toSend += randomInt(phase.burstMin, phase.burstMax);
    }

    for (let i = 0; i < toSend; i += 1) {
      seq += 1;
      if (state.pending.size >= phase.maxConcurrent) {
        state.phases[phase.id].dropped += 1;
        state.totals.dropped += 1;
        continue;
      }

      const clientIndex = users[randomInt(0, users.length - 1)];
      const event = buildInboundEvent(phase, clientIndex);
      const promise = dispatchEvent(event, phase, seq).finally(() => {
        state.pending.delete(promise);
      });
      state.pending.add(promise);
    }

    if (state.pending.size > state.maxPending) {
      state.maxPending = state.pending.size;
    }

    if (Date.now() - lastProgressAt >= PROGRESS_EVERY_MS) {
      lastProgressAt = Date.now();
      const pct = Number((((Date.now() - startedAt) / DURATION_MS) * 100).toFixed(1));
      console.log(
        `[${formatMs(Date.now() - startedAt)}][${pct}%] phase=${phase.id} rps=${rps} sent=${state.totals.sent} ok=${state.totals.ok} fail=${state.totals.failures} dropped=${state.totals.dropped} pending=${state.pending.size}`
      );
    }

    await sleep(TICK_MS);
  }

  const flushStart = Date.now();
  while (state.pending.size > 0 && Date.now() - flushStart < 5 * 60 * 1000) {
    await Promise.race([...state.pending]);
  }

  const report = buildReport(Date.now() - startedAt);
  const diagnostic = deriveDiagnostic(report, previousRun);
  const nextAdaptive = buildNextAdaptiveProfile(report, diagnostic);
  const nextActions = buildNextActions(report, diagnostic, nextAdaptive);
  const historyEntry = buildHistoryEntry(report, diagnostic);
  const updatedHistory = {
    version: 1,
    runs: [...historyRuns, historyEntry].slice(-80),
  };

  writeJsonFile(HISTORY_PATH, updatedHistory);
  if (ADAPTIVE_PROFILE_ENABLED) {
    writeJsonFile(ADAPTIVE_PROFILE_PATH, nextAdaptive);
  }
  writeJsonFile(NEXT_ACTIONS_PATH, nextActions);

  report.diagnostic = diagnostic;
  report.history = {
    totalRuns: updatedHistory.runs.length,
    previousRun: previousRun || null,
    latestEntries: updatedHistory.runs.slice(-5),
  };
  report.adaptive = {
    enabled: ADAPTIVE_PROFILE_ENABLED,
    profilePath: ADAPTIVE_PROFILE_PATH,
    appliedProfile: adaptiveProfile,
    nextProfile: nextAdaptive,
  };
  report.paths = {
    historyPath: HISTORY_PATH,
    adaptiveProfilePath: ADAPTIVE_PROFILE_PATH,
    nextActionsPath: NEXT_ACTIONS_PATH,
  };
  const paths = writeReport(report);

  console.log('Soak test finalizado.');
  console.log(`Report JSON: ${paths.jsonPath}`);
  console.log(`Report MD: ${paths.mdPath}`);
  console.log(`History: ${HISTORY_PATH}`);
  console.log(`Next actions: ${NEXT_ACTIONS_PATH}`);
  if (ADAPTIVE_PROFILE_ENABLED) {
    console.log(`Adaptive profile updated: ${ADAPTIVE_PROFILE_PATH}`);
  }
  console.log(
    JSON.stringify(
      {
        verdict: {
          score: report.diagnostic.score,
          grade: report.diagnostic.grade,
          strengths: report.diagnostic.strengths.slice(0, 4),
          topWeaknesses: report.diagnostic.weaknesses.slice(0, 3).map(w => w.title),
        },
        total: report.total,
        phaseSummary: report.phases.map(p => ({
          id: p.id,
          sent: p.sent,
          ok: p.ok,
          failures: p.failures,
          dropped: p.dropped,
          latencyP95: p.latencyMs.p95,
        })),
        priorities: report.diagnostic.recommendations.slice(0, 3),
      },
      null,
      2
    )
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

