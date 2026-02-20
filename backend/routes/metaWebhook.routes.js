const express = require('express');
const router = express.Router();
const logger = require('../logger');

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'zzeta_verify_token';
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
logger.info(
  `WHATSAPP config loaded graphVersion=${GRAPH_VERSION} phoneNumberIdSet=${Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID
  )} tokenSet=${Boolean(process.env.WHATSAPP_TOKEN)}`
);

function construirRespuesta(texto) {
  const msg = String(texto || '').toLowerCase();

  if (msg.includes('hola')) {
    return 'Hola! Soy ZZETA Bot. Puedo ayudarte a reservar tu turno.';
  }

  if (msg.includes('turno') || msg.includes('horario')) {
    return 'Decime qué servicio querés y para qué día, y te paso horarios disponibles.';
  }

  if (msg.includes('ubicacion') || msg.includes('donde')) {
    return 'Estamos en ZZETA Barber Club. Querés que te pase la ubicación exacta?';
  }

  return 'Recibí tu mensaje. Si querés, escribime "turno" y empezamos con la reserva.';
}

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

router.post('/', async (req, res) => {
  try {
    const debugMode = req.headers['x-webhook-debug'] === '1';
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const incoming = value?.messages?.[0];

    // Siempre responder 200 para que Meta no reintente en bucle
    if (!incoming) {
      if (debugMode) {
        return res.status(200).json({ ok: true, reason: 'no_message_event' });
      }
      return res.sendStatus(200);
    }

    const from = incoming.from;
    const texto = incoming.text?.body || '';
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
      text: { body: construirRespuesta(texto) },
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
