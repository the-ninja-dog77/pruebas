const logger = require('../logger');

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const WHATSAPP_PROVIDER =
  String(process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase() === 'gupshup'
    ? 'gupshup'
    : 'meta';
const GUPSHUP_BASE_URL = String(process.env.GUPSHUP_BASE_URL || 'https://api.gupshup.io').replace(
  /\/+$/,
  ''
);
const OUTBOUND_TIMEOUT_MS = Number(process.env.WHATSAPP_OUTBOUND_TIMEOUT_MS || 12000);
const OUTBOUND_RETRIES = Number(process.env.WHATSAPP_OUTBOUND_RETRIES || 1);
const OUTBOUND_BACKOFF_MS = Number(process.env.WHATSAPP_OUTBOUND_BACKOFF_MS || 350);

function getProvider() {
  return WHATSAPP_PROVIDER;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function getOutboundConfigSnapshot() {
  const metaPhoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const metaToken = String(process.env.WHATSAPP_TOKEN || '').trim();
  const gupshupKey = String(process.env.GUPSHUP_API_KEY || '').trim();
  const gupshupSource = String(process.env.GUPSHUP_SOURCE || '').trim();

  return {
    provider: WHATSAPP_PROVIDER,
    meta: {
      phoneNumberIdSet: Boolean(metaPhoneNumberId),
      tokenSet: Boolean(metaToken),
      graphVersion: GRAPH_VERSION,
    },
    gupshup: {
      apiKeySet: Boolean(gupshupKey),
      sourceSet: Boolean(gupshupSource),
      source: normalizePhone(gupshupSource) || null,
      appName: String(process.env.GUPSHUP_APP_NAME || '').trim() || null,
      baseUrl: GUPSHUP_BASE_URL,
    },
    retry: {
      timeoutMs: OUTBOUND_TIMEOUT_MS,
      retries: OUTBOUND_RETRIES,
      backoffMs: OUTBOUND_BACKOFF_MS,
    },
  };
}

function shouldRetryStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function postWithRetry({ url, headers, body, responseParser }) {
  const maxRetries = Math.max(0, Number(OUTBOUND_RETRIES || 0));
  const timeoutMs = Math.max(1000, Number(OUTBOUND_TIMEOUT_MS || 12000));
  const backoffMs = Math.max(100, Number(OUTBOUND_BACKOFF_MS || 350));

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers,
          body,
        },
        timeoutMs
      );

      if (!response.ok) {
        const bodyText = await response.text();
        if (attempt < maxRetries && shouldRetryStatus(response.status)) {
          attempt += 1;
          await sleep(backoffMs * attempt);
          continue;
        }

        return {
          ok: false,
          status: response.status,
          bodyText,
          retries: attempt,
        };
      }

      let payload = null;
      if (typeof responseParser === 'function') {
        payload = await responseParser(response);
      } else {
        try {
          payload = await response.json();
        } catch (_err) {
          payload = null;
        }
      }

      return {
        ok: true,
        status: response.status,
        payload,
        retries: attempt,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        attempt += 1;
        await sleep(backoffMs * attempt);
        continue;
      }

      return {
        ok: false,
        status: 500,
        bodyText: err.message || 'outbound_fetch_error',
        retries: attempt,
      };
    }
  }

  return {
    ok: false,
    status: 500,
    bodyText: (lastError && lastError.message) || 'outbound_unknown_error',
    retries: maxRetries,
  };
}

function getOutboundConfigError() {
  if (WHATSAPP_PROVIDER === 'gupshup') {
    const key = String(process.env.GUPSHUP_API_KEY || '').trim();
    const source = String(process.env.GUPSHUP_SOURCE || '').trim();
    if (!key || !source) {
      return 'GUPSHUP_API_KEY o GUPSHUP_SOURCE no configurados';
    }
    return null;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return 'WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_TOKEN no configurados';
  }
  return null;
}

async function sendMetaTextMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_TOKEN;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  return postWithRetry({
    url,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    responseParser: async response => response.json(),
  });
}

async function sendGupshupTextMessage(to, text) {
  const key = String(process.env.GUPSHUP_API_KEY || '').trim();
  const source = String(process.env.GUPSHUP_SOURCE || '').trim();
  const appName = String(process.env.GUPSHUP_APP_NAME || '').trim();

  const body = new URLSearchParams();
  body.set('channel', 'whatsapp');
  body.set('source', source);
  body.set('destination', to);
  body.set(
    'message',
    JSON.stringify({
      type: 'text',
      text,
    })
  );
  if (appName) {
    body.set('src.name', appName);
  }

  const url = `${GUPSHUP_BASE_URL}/wa/api/v1/msg`;
  return postWithRetry({
    url,
    headers: {
      apikey: key,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: body.toString(),
    responseParser: async response => {
      try {
        return await response.json();
      } catch (_err) {
        return { status: 'accepted' };
      }
    },
  });
}

async function sendTextMessage(to, text) {
  const configErr = getOutboundConfigError();
  if (configErr) {
    return { ok: false, status: 500, bodyText: configErr };
  }

  if (WHATSAPP_PROVIDER === 'gupshup') {
    return sendGupshupTextMessage(to, text);
  }

  return sendMetaTextMessage(to, text);
}

async function sendSafe(to, text, context = {}) {
  try {
    const outbound = await sendTextMessage(to, text);
    if (!outbound.ok) {
      logger.error(
        `WHATSAPP sender failed provider=${WHATSAPP_PROVIDER} status=${outbound.status} context=${JSON.stringify(
          context
        )} retries=${Number(outbound.retries || 0)} body=${outbound.bodyText || ''}`
      );
    }
    return outbound;
  } catch (err) {
    logger.error(
      `WHATSAPP sender exception provider=${WHATSAPP_PROVIDER} context=${JSON.stringify(
        context
      )} err=${err.stack || err.message}`
    );
    return { ok: false, status: 500, bodyText: err.message };
  }
}

module.exports = {
  getProvider,
  getOutboundConfigSnapshot,
  getOutboundConfigError,
  sendTextMessage,
  sendSafe,
};
