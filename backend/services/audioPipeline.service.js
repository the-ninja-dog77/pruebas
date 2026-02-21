const logger = require('../logger');
const audioStt = require('./audioStt.service');
const audioMetrics = require('./audioObservability.service');

const AUDIO_MIN_DURATION_SEC = Number(process.env.AUDIO_MIN_DURATION_SEC || 0.3);
const AUDIO_MAX_DURATION_SEC = Number(process.env.AUDIO_MAX_DURATION_SEC || 300);
const AUDIO_MAX_BYTES = Number(process.env.AUDIO_MAX_BYTES || 16 * 1024 * 1024);
const AUDIO_QUEUE_LIMIT = Number(process.env.AUDIO_QUEUE_LIMIT || 200);
const AUDIO_QUEUE_TIMEOUT_MS = Number(process.env.AUDIO_QUEUE_TIMEOUT_MS || 15000);
const AUDIO_STT_CONCURRENCY = Number(process.env.AUDIO_STT_CONCURRENCY || 6);
const AUDIO_CONFIDENCE_MIN = Number(process.env.AUDIO_CONFIDENCE_MIN || 0.55);
const AUDIO_CONFIDENCE_ACTION = Number(process.env.AUDIO_CONFIDENCE_ACTION || 0.72);
const AUDIO_CONFIDENCE_DESTRUCTIVE = Number(
  process.env.AUDIO_CONFIDENCE_DESTRUCTIVE || 0.85
);
function normalizeMimeType(value) {
  const raw = String(value || '')
    .toLowerCase()
    .trim();
  if (!raw) return '';
  const [base] = raw.split(';');
  return String(base || '').trim();
}

const SUPPORTED_AUDIO_MIME = String(
  process.env.SUPPORTED_AUDIO_MIME ||
    'audio/ogg,audio/opus,audio/mpeg,audio/mp4,audio/wav,audio/webm'
)
  .split(',')
  .map(x => normalizeMimeType(x))
  .filter(Boolean);

const queue = [];
let active = 0;

function nowMs() {
  return Date.now();
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function classifyIntentRisk(text) {
  const msg = normalizeText(text);
  if (
    msg.includes('cancelar') ||
    msg.includes('anular') ||
    msg.includes('eliminar') ||
    msg.includes('borrar') ||
    msg.includes('reprogramar') ||
    msg.includes('mover turno')
  ) {
    return 'destructive';
  }
  if (
    msg.includes('confirmar') ||
    msg.includes('turno') ||
    msg.includes('reserv') ||
    msg.includes('agend')
  ) {
    return 'actionable';
  }
  return 'informational';
}

function runQueuedTask() {
  if (active >= AUDIO_STT_CONCURRENCY) return;
  const item = queue.shift();
  if (!item) return;
  active += 1;
  Promise.resolve()
    .then(item.task)
    .then(result => item.resolve(result))
    .catch(err => item.reject(err))
    .finally(() => {
      active -= 1;
      runQueuedTask();
    });
}

function enqueueTask(task) {
  if (queue.length >= AUDIO_QUEUE_LIMIT) {
    audioMetrics.recordQueueRejection();
    return Promise.resolve({
      ok: false,
      reason: 'audio_queue_full',
      failureType: 'timing',
    });
  }

  audioMetrics.recordQueueDepth(queue.length + 1);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      audioMetrics.recordQueueTimeout();
      reject(new Error('audio_queue_timeout'));
    }, AUDIO_QUEUE_TIMEOUT_MS);

    queue.push({
      task: async () => {
        clearTimeout(timeout);
        return task();
      },
      resolve,
      reject,
    });
    runQueuedTask();
  });
}

function parseDebugFlags(audioObj) {
  const raw = audioObj?.debug_flags;
  if (Array.isArray(raw)) {
    return raw.map(x => normalizeText(x));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map(x => normalizeText(x))
      .filter(Boolean);
  }
  return [];
}

function processDebugTranscript(audioObj) {
  const text = String(audioObj?.debug_transcript || '').trim();
  if (!text) return null;
  const confidenceRaw = Number(audioObj?.debug_confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.75;

  return {
    ok: true,
    text,
    confidence,
    retries: 0,
    reason: 'debug_transcript',
  };
}

function unsupportedMime(mimeType) {
  if (!mimeType) return false;
  const normalized = normalizeMimeType(mimeType);
  return !SUPPORTED_AUDIO_MIME.includes(normalized);
}

function fallbackReplyByReason(reason) {
  switch (reason) {
    case 'audio_too_short':
      return 'El audio fue demasiado corto. Podrias repetirlo un poco mas claro o escribir en texto?';
    case 'audio_too_long':
      return 'El audio es muy largo para procesarlo completo. Enviame uno mas corto o escribime en texto.';
    case 'audio_noise_or_silence':
      return 'No pude entender el audio por ruido o silencio. Repetilo por favor o escribime en texto.';
    case 'unsupported_audio_mime':
      return 'Ese formato de audio no esta soportado. Si queres, escribime el mensaje en texto.';
    case 'audio_queue_full':
      return 'Estoy recibiendo muchos audios al mismo tiempo. Reintenta en unos segundos, por favor.';
    case 'audio_queue_timeout':
      return 'Se demoro demasiado el procesamiento del audio. Reenvialo por favor.';
    case 'stt_timeout_or_network':
      return 'Tuve un problema temporal al transcribir el audio. Podes reenviarlo o escribir en texto.';
    case 'stt_empty_transcript':
      return 'No pude extraer texto util del audio. Podrias repetirlo o escribir en texto?';
    case 'stt_not_configured':
      return 'Ahora mismo no tengo transcripcion de audio activa. Escribime en texto por favor.';
    case 'missing_media_id':
      return 'No recibi bien el audio. Reenvialo por favor o escribime en texto.';
    default:
      return 'No pude procesar ese audio. Repetilo por favor o escribime en texto.';
  }
}

function classifyFailureType(reason) {
  if (
    ['audio_too_short', 'audio_too_long', 'audio_noise_or_silence', 'unsupported_audio_mime'].includes(
      reason
    )
  ) {
    return 'audio';
  }
  if (reason && reason.startsWith('stt_')) return 'stt';
  if (reason && reason.startsWith('audio_queue')) return 'timing';
  return 'intent';
}

async function processAudioMessage({
  incoming,
  from,
  accessToken,
  graphVersion,
  buildReply,
}) {
  const startedAt = nowMs();
  const audioObj = incoming?.audio || {};
  const mimeType = normalizeMimeType(audioObj.mime_type);
  const mediaId = String(audioObj.id || '').trim();
  const durationSec = Number(
    audioObj.duration_sec || audioObj.duration || audioObj.debug_duration_sec
  );
  const fileSize = Number(audioObj.file_size || audioObj.debug_file_size || 0);
  const flags = parseDebugFlags(audioObj);

  if (Number.isFinite(durationSec) && durationSec > 0 && durationSec < AUDIO_MIN_DURATION_SEC) {
    const reason = 'audio_too_short';
    audioMetrics.record({
      discarded: true,
      reason,
      failureType: classifyFailureType(reason),
      latencyMs: nowMs() - startedAt,
    });
    return { ok: true, reply: fallbackReplyByReason(reason), reason };
  }

  if (Number.isFinite(durationSec) && durationSec > AUDIO_MAX_DURATION_SEC) {
    const reason = 'audio_too_long';
    audioMetrics.record({
      discarded: true,
      reason,
      failureType: classifyFailureType(reason),
      latencyMs: nowMs() - startedAt,
    });
    return { ok: true, reply: fallbackReplyByReason(reason), reason };
  }

  if (Number.isFinite(fileSize) && fileSize > AUDIO_MAX_BYTES) {
    const reason = 'audio_too_long';
    audioMetrics.record({
      discarded: true,
      reason,
      failureType: classifyFailureType(reason),
      latencyMs: nowMs() - startedAt,
    });
    return { ok: true, reply: fallbackReplyByReason(reason), reason };
  }

  if (unsupportedMime(mimeType)) {
    const reason = 'unsupported_audio_mime';
    audioMetrics.record({
      discarded: true,
      reason,
      failureType: classifyFailureType(reason),
      latencyMs: nowMs() - startedAt,
    });
    return { ok: true, reply: fallbackReplyByReason(reason), reason };
  }

  if (
    flags.some(flag =>
      ['silence', 'noise', 'noise_only', 'abrupt_cut', 'low_volume', 'clipping'].includes(flag)
    )
  ) {
    const reason = 'audio_noise_or_silence';
    audioMetrics.record({
      discarded: true,
      reason,
      failureType: classifyFailureType(reason),
      latencyMs: nowMs() - startedAt,
    });
    return { ok: true, reply: fallbackReplyByReason(reason), reason };
  }

  let transcript = processDebugTranscript(audioObj);
  if (!transcript) {
    if (!mediaId) {
      const reason = 'missing_media_id';
      audioMetrics.record({
        discarded: true,
        reason,
        failureType: 'audio',
        latencyMs: nowMs() - startedAt,
      });
      return { ok: true, reply: fallbackReplyByReason(reason), reason };
    }

    try {
      transcript = await enqueueTask(() =>
        audioStt.transcribeFromWhatsAppMedia({
          mediaId,
          accessToken,
          graphVersion,
          mimeTypeHint: mimeType,
          filenameHint: `${mediaId}.ogg`,
        })
      );
    } catch (_err) {
      transcript = {
        ok: false,
        reason: 'audio_queue_timeout',
        failureType: 'timing',
      };
    }
  }

  if (!transcript || !transcript.ok) {
    const reason = transcript?.reason || 'stt_unknown';
    audioMetrics.record({
      discarded: true,
      reason,
      failureType: transcript?.failureType || classifyFailureType(reason),
      latencyMs: nowMs() - startedAt,
      sttRetry: Number(transcript?.retries || 0) > 0,
    });
    return {
      ok: true,
      reply: fallbackReplyByReason(reason),
      reason,
    };
  }

  const text = String(transcript.text || '').trim();
  const confidence = Number.isFinite(transcript.confidence)
    ? Math.max(0, Math.min(1, transcript.confidence))
    : 0.72;
  const risk = classifyIntentRisk(text);

  if (!text) {
    const reason = 'stt_empty_transcript';
    audioMetrics.record({
      discarded: true,
      reason,
      failureType: 'stt',
      latencyMs: nowMs() - startedAt,
      confidence,
    });
    return { ok: true, reply: fallbackReplyByReason(reason), reason };
  }

  if (confidence < AUDIO_CONFIDENCE_MIN) {
    const reason = 'low_confidence';
    audioMetrics.record({
      discarded: true,
      clarification: true,
      lowConfidence: true,
      reason,
      failureType: 'intent',
      latencyMs: nowMs() - startedAt,
      confidence,
    });
    return {
      ok: true,
      reply:
        'No entendi con suficiente claridad ese audio. Repetilo por favor o escribime el mensaje en texto.',
      reason,
      confidence,
      transcript: text,
    };
  }

  if (risk === 'destructive' && confidence < AUDIO_CONFIDENCE_DESTRUCTIVE) {
    const reason = 'destructive_low_confidence';
    audioMetrics.record({
      processed: true,
      clarification: true,
      lowConfidence: true,
      reason,
      failureType: 'state',
      latencyMs: nowMs() - startedAt,
      confidence,
    });
    return {
      ok: true,
      reply: `Escuche "${text}". Para evitar errores en una accion sensible, escribime ese comando en texto (ej: "cancelar turno").`,
      reason,
      confidence,
      transcript: text,
    };
  }

  if (risk === 'actionable' && confidence < AUDIO_CONFIDENCE_ACTION) {
    const reason = 'actionable_low_confidence';
    audioMetrics.record({
      processed: true,
      clarification: true,
      lowConfidence: true,
      reason,
      failureType: 'intent',
      latencyMs: nowMs() - startedAt,
      confidence,
    });
    return {
      ok: true,
      reply: `Escuche "${text}", pero necesito un poco mas de claridad. Repetilo o escribilo en texto.`,
      reason,
      confidence,
      transcript: text,
    };
  }

  const reply = await buildReply(from, text, {
    source: 'audio',
    confidence,
    intentRisk: risk,
  });

  const normalizedReply = normalizeText(reply);
  audioMetrics.record({
    processed: true,
    reason: 'audio_processed',
    latencyMs: nowMs() - startedAt,
    confidence,
    executedAction:
      normalizedReply.includes('turno confirmado') ||
      normalizedReply.includes('reprogramado') ||
      normalizedReply.includes('cancele tu turno'),
    confirmedAction: normalizedReply.includes('si queres confirmar'),
    sttRetry: Number(transcript.retries || 0) > 0,
  });

  logger.info(
    `AUDIO processed from=${from} confidence=${confidence.toFixed(3)} risk=${risk} text="${text}"`
  );

  return {
    ok: true,
    reply,
    reason: 'audio_processed',
    confidence,
    transcript: text,
    risk,
  };
}

module.exports = {
  processAudioMessage,
  classifyIntentRisk,
};
