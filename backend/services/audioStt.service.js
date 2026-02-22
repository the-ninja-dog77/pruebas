const logger = require('../logger');

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveGroqBaseUrl() {
  const raw = process.env.GROQ_BASE_URL || process.env.OPENAI_BASE_URL || '';
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return DEFAULT_GROQ_BASE_URL;

  if (normalized.includes('console.groq.com') || normalized.includes('/keys')) {
    logger.warn(
      `AUDIO STT invalid GROQ_BASE_URL detected (${normalized}); using default ${DEFAULT_GROQ_BASE_URL}`
    );
    return DEFAULT_GROQ_BASE_URL;
  }

  if (!/^https?:\/\//i.test(normalized)) {
    logger.warn(
      `AUDIO STT non-http GROQ_BASE_URL detected (${normalized}); using default ${DEFAULT_GROQ_BASE_URL}`
    );
    return DEFAULT_GROQ_BASE_URL;
  }

  return normalized;
}

const GROQ_BASE_URL = resolveGroqBaseUrl();
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
const STT_PROVIDER_RAW = String(process.env.AUDIO_STT_PROVIDER || 'groq').toLowerCase();
const STT_PROVIDER = STT_PROVIDER_RAW === 'groq' ? 'groq' : 'groq';
const STT_MODEL = process.env.AUDIO_STT_MODEL || 'whisper-large-v3-turbo';
const STT_TIMEOUT_MS = Number(process.env.AUDIO_STT_TIMEOUT_MS || 15000);
const MEDIA_TIMEOUT_MS = Number(process.env.AUDIO_MEDIA_TIMEOUT_MS || STT_TIMEOUT_MS);
const STT_REQUEST_TIMEOUT_MS = Number(
  process.env.AUDIO_STT_REQUEST_TIMEOUT_MS || STT_TIMEOUT_MS
);
const STT_MAX_RETRIES = Number(process.env.AUDIO_STT_RETRIES || 1);
const MEDIA_METADATA_RETRIES = Number(process.env.AUDIO_MEDIA_METADATA_RETRIES || 1);
const MEDIA_DOWNLOAD_RETRIES = Number(process.env.AUDIO_MEDIA_DOWNLOAD_RETRIES || 1);
const RETRY_BACKOFF_MS = Number(process.env.AUDIO_RETRY_BACKOFF_MS || 300);

if (STT_PROVIDER_RAW !== 'groq') {
  logger.warn(`AUDIO STT unsupported provider "${STT_PROVIDER_RAW}", forcing provider=groq`);
}

logger.info(
  `AUDIO STT config provider=${STT_PROVIDER} baseUrl=${GROQ_BASE_URL} keySet=${Boolean(
    GROQ_API_KEY
  )} model=${STT_MODEL}`
);

async function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sleepWithJitter(baseMs, attempt) {
  const base = Math.max(1, Number(baseMs || RETRY_BACKOFF_MS));
  const jitter = Math.floor(Math.random() * Math.min(150, base));
  return sleep(base * Math.max(1, attempt) + jitter);
}

function asNonNegativeInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function asPositiveInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function resolveRuntimeProfile(retryProfile = {}) {
  return {
    metadataRetries: asNonNegativeInt(retryProfile.metadataRetries, MEDIA_METADATA_RETRIES),
    downloadRetries: asNonNegativeInt(retryProfile.downloadRetries, MEDIA_DOWNLOAD_RETRIES),
    sttRetries: asNonNegativeInt(retryProfile.sttRetries, STT_MAX_RETRIES),
    metadataTimeoutMs: asPositiveInt(retryProfile.metadataTimeoutMs, MEDIA_TIMEOUT_MS),
    downloadTimeoutMs: asPositiveInt(retryProfile.downloadTimeoutMs, MEDIA_TIMEOUT_MS),
    sttTimeoutMs: asPositiveInt(retryProfile.sttTimeoutMs, STT_REQUEST_TIMEOUT_MS),
    backoffMs: asPositiveInt(retryProfile.backoffMs, RETRY_BACKOFF_MS),
  };
}

function shouldRetryStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function classifyMediaHttpError(status, operation) {
  if (status === 401 || status === 403) return 'media_auth_error';
  if (status === 404) {
    if (operation === 'download') return 'media_url_expired_or_not_found';
    return 'media_not_found';
  }
  if (status === 408 || status === 429 || status >= 500) return 'media_timeout';
  return 'audio_pipeline_error';
}

function classifySttHttpError(status) {
  if (status === 401 || status === 403) return 'stt_auth_error';
  return 'stt_provider_error';
}

function buildMediaUrl({ mediaId, graphVersion, phoneNumberId }) {
  const base = `https://graph.facebook.com/${graphVersion}/${mediaId}`;
  if (!phoneNumberId) return base;
  return `${base}?phone_number_id=${encodeURIComponent(String(phoneNumberId))}`;
}

async function fetchMediaMetadata({
  mediaId,
  accessToken,
  graphVersion,
  phoneNumberId,
  runtime,
}) {
  const url = buildMediaUrl({ mediaId, graphVersion, phoneNumberId });
  let retries = 0;

  while (retries <= runtime.metadataRetries) {
    try {
      const response = await withTimeout(
        signal =>
          fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal,
          }),
        runtime.metadataTimeoutMs
      );

      if (!response.ok) {
        const body = await response.text();
        const reason = classifyMediaHttpError(response.status, 'metadata');
        if (retries < runtime.metadataRetries && shouldRetryStatus(response.status)) {
          retries += 1;
          await sleepWithJitter(runtime.backoffMs, retries);
          continue;
        }

        return {
          ok: false,
          reason,
          status: response.status,
          body,
          retries,
        };
      }

      const data = await response.json();
      return {
        ok: true,
        data,
        retries,
      };
    } catch (err) {
      if (retries < runtime.metadataRetries) {
        retries += 1;
        await sleepWithJitter(runtime.backoffMs, retries);
        continue;
      }
      logger.error(`AUDIO metadata timeout/error: ${err.message}`);
      return {
        ok: false,
        reason: 'media_timeout',
        retries,
      };
    }
  }

  return {
    ok: false,
    reason: 'media_timeout',
    retries: runtime.metadataRetries,
  };
}

async function downloadMediaBuffer({ mediaUrl, accessToken, runtime }) {
  let retries = 0;
  while (retries <= runtime.downloadRetries) {
    try {
      const response = await withTimeout(
        signal =>
          fetch(mediaUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal,
          }),
        runtime.downloadTimeoutMs
      );

      if (!response.ok) {
        const body = await response.text();
        const reason = classifyMediaHttpError(response.status, 'download');
        if (retries < runtime.downloadRetries && shouldRetryStatus(response.status)) {
          retries += 1;
          await sleepWithJitter(runtime.backoffMs, retries);
          continue;
        }

        return {
          ok: false,
          reason,
          status: response.status,
          body,
          retries,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'audio/ogg';
      return {
        ok: true,
        buffer: Buffer.from(arrayBuffer),
        contentType,
        retries,
      };
    } catch (err) {
      if (retries < runtime.downloadRetries) {
        retries += 1;
        await sleepWithJitter(runtime.backoffMs, retries);
        continue;
      }
      logger.error(`AUDIO media download timeout/error: ${err.message}`);
      return {
        ok: false,
        reason: 'media_timeout',
        retries,
      };
    }
  }

  return {
    ok: false,
    reason: 'media_timeout',
    retries: runtime.downloadRetries,
  };
}

async function transcribeWithGroq({ buffer, mimeType, filename, runtime }) {
  if (!GROQ_API_KEY) {
    return {
      ok: false,
      reason: 'stt_not_configured',
      failureType: 'stt',
    };
  }

  let retries = 0;
  while (retries <= runtime.sttRetries) {
    try {
      const blob = new Blob([buffer], { type: mimeType || 'audio/ogg' });
      const form = new FormData();
      form.append('file', blob, filename || 'audio.ogg');
      form.append('model', STT_MODEL);
      form.append('response_format', 'verbose_json');
      form.append('temperature', '0');

      const response = await withTimeout(
        signal =>
          fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: form,
            signal,
          }),
        runtime.sttTimeoutMs
      );

      if (!response.ok) {
        const errText = await response.text();
        if (retries < runtime.sttRetries && shouldRetryStatus(response.status)) {
          retries += 1;
          await sleepWithJitter(runtime.backoffMs, retries);
          continue;
        }
        logger.error(`AUDIO STT failed status=${response.status} body=${errText}`);
        return {
          ok: false,
          reason: classifySttHttpError(response.status),
          failureType: 'stt',
          retries,
        };
      }

      const data = await response.json();
      const text = String(data?.text || '').trim();
      if (!text) {
        return {
          ok: false,
          reason: 'stt_empty_transcript',
          failureType: 'stt',
          retries,
        };
      }

      return {
        ok: true,
        text,
        confidence: 0.72,
        retries,
        raw: data,
      };
    } catch (err) {
      if (retries < runtime.sttRetries) {
        retries += 1;
        await sleepWithJitter(runtime.backoffMs, retries);
        continue;
      }
      logger.error(`AUDIO STT timeout/error: ${err.message}`);
      return {
        ok: false,
        reason: 'stt_timeout_or_network',
        failureType: 'timing',
        retries,
      };
    }
  }

  return {
    ok: false,
    reason: 'stt_unknown',
    failureType: 'stt',
  };
}

async function transcribeFromWhatsAppMedia({
  mediaId,
  accessToken,
  graphVersion,
  phoneNumberId,
  mimeTypeHint,
  filenameHint,
  retryProfile,
}) {
  try {
    const runtime = resolveRuntimeProfile(retryProfile);
    const metadataResult = await fetchMediaMetadata({
      mediaId,
      accessToken,
      graphVersion,
      phoneNumberId,
      runtime,
    });
    if (!metadataResult.ok) {
      return {
        ok: false,
        reason: metadataResult.reason || 'audio_pipeline_error',
        failureType: metadataResult.reason === 'media_timeout' ? 'timing' : 'audio',
        retries: Number(metadataResult.retries || 0),
      };
    }

    const metadata = metadataResult.data || {};
    const mediaUrl = metadata.url;
    if (!mediaUrl) {
      return {
        ok: false,
        reason: 'missing_media_url',
        failureType: 'audio',
      };
    }

    const downloaded = await downloadMediaBuffer({
      mediaUrl,
      accessToken,
      runtime,
    });
    if (!downloaded.ok) {
      return {
        ok: false,
        reason: downloaded.reason || 'audio_pipeline_error',
        failureType: downloaded.reason === 'media_timeout' ? 'timing' : 'audio',
        retries: Number(downloaded.retries || 0),
      };
    }

    const mimeType = mimeTypeHint || metadata.mime_type || downloaded.contentType || 'audio/ogg';
    const filename = filenameHint || `${mediaId}.ogg`;
    const sizeBytes = downloaded.buffer.length;

    if (STT_PROVIDER !== 'groq') {
      return {
        ok: false,
        reason: 'stt_provider_not_supported',
        failureType: 'stt',
      };
    }

    const transcript = await transcribeWithGroq({
      buffer: downloaded.buffer,
      mimeType,
      filename,
      runtime,
    });

    return {
      ...transcript,
      sizeBytes,
      mimeType,
      retries:
        Number(transcript.retries || 0) +
        Number(metadataResult.retries || 0) +
        Number(downloaded.retries || 0),
    };
  } catch (err) {
    logger.error(`AUDIO media pipeline failed: ${err.stack || err.message}`);
    return {
      ok: false,
      reason: 'audio_pipeline_error',
      failureType: 'audio',
    };
  }
}

module.exports = {
  transcribeFromWhatsAppMedia,
};
