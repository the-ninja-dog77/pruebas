const logger = require('../logger');

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function isEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function isQuestionLike(message) {
  const msg = String(message || '').toLowerCase();
  return (
    msg.includes('?') ||
    msg.startsWith('que ') ||
    msg.startsWith('como ') ||
    msg.startsWith('cuando ') ||
    msg.startsWith('cuanto ') ||
    msg.startsWith('donde ') ||
    msg.startsWith('por que ')
  );
}

function buildSystemPrompt(session) {
  return [
    'Sos ZZETA Bot, asistente de ZZETA Barber Club.',
    'Objetivo principal: ayudar a reservar turnos y responder dudas del negocio.',
    'Responde en espanol neutro, breve y claro.',
    'Si el usuario se va de tema (politica, tareas generales, etc), responde una sola frase:',
    '"Solo puedo ayudarte con turnos, horarios, servicios y ubicacion de ZZETA Barber Club."',
    'Si hay una reserva en curso, manten el contexto y guia al siguiente paso sin perder datos.',
    `Estado actual: ${JSON.stringify(session)}`,
  ].join('\n');
}

async function generateReply(message, session) {
  if (!isEnabled()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        max_tokens: 160,
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(session),
          },
          {
            role: 'user',
            content: String(message || ''),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`AI fallback failed status=${response.status} body=${errText}`);
      return null;
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return null;

    return String(text).trim();
  } catch (err) {
    logger.error(`AI fallback error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  isEnabled,
  isQuestionLike,
  generateReply,
};
