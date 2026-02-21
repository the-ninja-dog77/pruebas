const logger = require('../logger');

const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  'https://api.groq.com/openai/v1';
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
const STT_PROVIDER = String(process.env.AUDIO_STT_PROVIDER || 'groq').toLowerCase();
const STT_MODEL = process.env.AUDIO_STT_MODEL || 'whisper-large-v3-turbo';
const STT_TIMEOUT_MS = Number(process.env.AUDIO_STT_TIMEOUT_MS || 15000);
const STT_MAX_RETRIES = Number(process.env.AUDIO_STT_RETRIES || 1);

async function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMediaMetadata({ mediaId, accessToken, graphVersion }) {
  const url = `https://graph.facebook.com/${graphVersion}/${mediaId}`;
  const response = await withTimeout(
    signal =>
      fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal,
      }),
    STT_TIMEOUT_MS
  );

  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`Media metadata failed status=${response.status} body=${body}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

async function downloadMediaBuffer({ mediaUrl, accessToken }) {
  const response = await withTimeout(
    signal =>
      fetch(mediaUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal,
      }),
    STT_TIMEOUT_MS
  );

  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`Media download failed status=${response.status} body=${body}`);
    err.status = response.status;
    throw err;
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'audio/ogg';
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}

async function transcribeWithGroq({ buffer, mimeType, filename }) {
  if (!GROQ_API_KEY) {
    return {
      ok: false,
      reason: 'stt_not_configured',
      failureType: 'stt',
    };
  }

  const blob = new Blob([buffer], { type: mimeType || 'audio/ogg' });
  const form = new FormData();
  form.append('file', blob, filename || 'audio.ogg');
  form.append('model', STT_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  let retries = 0;
  while (retries <= STT_MAX_RETRIES) {
    try {
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
        STT_TIMEOUT_MS
      );

      if (!response.ok) {
        const errText = await response.text();
        if (retries < STT_MAX_RETRIES) {
          retries += 1;
          continue;
        }
        logger.error(`AUDIO STT failed status=${response.status} body=${errText}`);
        return {
          ok: false,
          reason: 'stt_provider_error',
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
      if (retries < STT_MAX_RETRIES) {
        retries += 1;
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
  mimeTypeHint,
  filenameHint,
}) {
  try {
    const metadata = await fetchMediaMetadata({
      mediaId,
      accessToken,
      graphVersion,
    });
    const mediaUrl = metadata?.url;
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
    });

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
    });

    return {
      ...transcript,
      sizeBytes,
      mimeType,
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
