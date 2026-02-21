const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = `zzeta.audio.${Date.now()}.db`;
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_TOKEN = 'test_token';
process.env.WHATSAPP_GRAPH_VERSION = 'v24.0';
process.env.BOT_MIN_LEAD_MINUTES = '0';
process.env.META_APP_SECRET = 'meta_app_secret_audio_test';
process.env.WHATSAPP_SIGNATURE_REQUIRED = 'true';
process.env.WHATSAPP_SESSION_TTL_MS = '800';
delete process.env.GROQ_API_KEY;
delete process.env.OPENAI_API_KEY;

const app = require('../index');

describe('WhatsApp audio reliability pipeline', () => {
  const outboundMessages = [];
  const matrixResults = [];
  let reqCounter = 0;

  beforeAll(() => {
    global.fetch = jest.fn(async (url, opts) => {
      if (String(url).includes('/messages')) {
        const payload = JSON.parse(opts.body);
        outboundMessages.push(payload.text.body);
        return {
          ok: true,
          json: async () => ({ messages: [{ id: `wamid.audio.${Date.now()}` }] }),
          text: async () => '',
        };
      }

      return {
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'unexpected fetch in audio test' } }),
        text: async () => 'unexpected fetch in audio test',
      };
    });
  });

  beforeEach(() => {
    outboundMessages.length = 0;
  });

  afterAll(() => {
    try {
      const reportsDir = path.join(__dirname, '..', 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportsDir, 'audio-reliability-matrix.latest.json'),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            totalCases: matrixResults.length,
            cases: matrixResults,
          },
          null,
          2
        )
      );
    } catch (_err) {
      // no-op
    }
    jest.restoreAllMocks();
  });

  function recordCase(entry) {
    matrixResults.push(entry);
  }

  function signature(raw) {
    return `sha256=${crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(raw)
      .digest('hex')}`;
  }

  function buildAudioPayload({
    from = '595985570001',
    id = `wamid.audio.${Date.now()}.${Math.random().toString(16).slice(2)}`,
    timestamp = String(Math.floor(Date.now() / 1000)),
    mimeType = 'audio/ogg',
    debugTranscript = 'hola',
    debugConfidence = 0.95,
    debugDurationSec = 3,
    debugFlags = [],
    fileSize = 20480,
  } = {}) {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
                    id,
                    timestamp,
                    type: 'audio',
                    audio: {
                      id: `media-${id}`,
                      mime_type: mimeType,
                      file_size: fileSize,
                      debug_transcript: debugTranscript,
                      debug_confidence: debugConfidence,
                      debug_duration_sec: debugDurationSec,
                      debug_flags: debugFlags,
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  function buildTextPayload({
    from = '595985570001',
    id = `wamid.text.${Date.now()}.${Math.random().toString(16).slice(2)}`,
    timestamp = String(Math.floor(Date.now() / 1000)),
    text = 'hola',
  } = {}) {
    return {
      entry: [
        {
          changes: [
            {
              value: {
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

  async function sendPayload(payload, debug = true) {
    reqCounter += 1;
    const raw = JSON.stringify(payload);
    const started = Date.now();
    let req = request(app)
      .post('/meta-webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature(raw))
      .set('x-forwarded-for', `10.77.0.${reqCounter % 250}`)
      .send(raw);

    if (debug) {
      req = req.set('x-webhook-debug', '1');
    }

    const res = await req;
    return {
      res,
      reply: outboundMessages[outboundMessages.length - 1] || '',
      latencyMs: Date.now() - started,
    };
  }

  test('handles raw audio edge cases with safe fallback and no hang', async () => {
    const from = '595985570011';
    const cases = [
      buildAudioPayload({
        from,
        id: 'a-short',
        debugDurationSec: 0.2,
        debugTranscript: '',
      }),
      buildAudioPayload({
        from,
        id: 'a-long',
        debugDurationSec: 340,
        debugTranscript: 'quiero turno',
      }),
      buildAudioPayload({
        from,
        id: 'a-noise',
        debugFlags: ['noise_only'],
        debugTranscript: '',
      }),
      buildAudioPayload({
        from,
        id: 'a-silence',
        debugFlags: ['silence'],
        debugTranscript: '',
      }),
      buildAudioPayload({
        from,
        id: 'a-clipping',
        debugFlags: ['clipping'],
        debugTranscript: 'turno',
      }),
      buildAudioPayload({
        from,
        id: 'a-unsupported',
        mimeType: 'audio/flac',
        debugTranscript: 'turno',
      }),
    ];

    for (const payload of cases) {
      const { res, reply, latencyMs } = await sendPayload(payload);
      expect(res.statusCode).toBe(200);
      expect(reply.length).toBeGreaterThan(5);
      recordCase({
        dimension: 'A',
        caseName: `audio-edge-${payload.entry[0].changes[0].value.messages[0].id}`,
        input: payload.entry[0].changes[0].value.messages[0].audio,
        previousState: 'idle/active',
        expected: 'fallback sin romper estado',
        actual: reply,
        latencyMs,
        fallback: reply,
      });
    }

    const recovery = await sendPayload(
      buildTextPayload({ from, id: 'a-recovery', text: 'turno' })
    );
    expect(recovery.res.statusCode).toBe(200);
    expect(recovery.reply).toContain('Que servicio queres');
  });

  test('low confidence audio does not advance dangerous action', async () => {
    const from = '595985570012';

    const createFlow = [
      buildTextPayload({ from, id: 'lc-1', text: 'turno' }),
      buildTextPayload({ from, id: 'lc-2', text: 'corte' }),
      buildTextPayload({ from, id: 'lc-3', text: '2099-12-31' }),
      buildTextPayload({ from, id: 'lc-4', text: '16:00' }),
      buildTextPayload({ from, id: 'lc-5', text: 'Carlos Soto' }),
      buildTextPayload({ from, id: 'lc-6', text: 'efectivo' }),
      buildTextPayload({ from, id: 'lc-7', text: 'confirmar' }),
    ];

    for (const payload of createFlow) {
      const { res } = await sendPayload(payload);
      expect(res.statusCode).toBe(200);
    }

    const destructiveLowConfidence = await sendPayload(
      buildAudioPayload({
        from,
        id: 'lc-audio-cancel',
        debugTranscript: 'cancelar turno',
        debugConfidence: 0.62,
        debugDurationSec: 4,
      })
    );
    expect(destructiveLowConfidence.res.statusCode).toBe(200);
    expect(destructiveLowConfidence.reply).toContain('accion sensible');
    recordCase({
      dimension: 'B',
      caseName: 'destructive-low-confidence',
      input: 'cancelar turno (audio)',
      previousState: 'turno activo confirmado',
      expected: 'no ejecutar accion, pedir confirmacion en texto',
      actual: destructiveLowConfidence.reply,
      latencyMs: destructiveLowConfidence.latencyMs,
      fallback: 'confirmacion obligatoria',
    });

    const checkStillBooked = await sendPayload(
      buildTextPayload({ from, id: 'lc-check', text: 'hay turno el 2099-12-31 a las 16:00?' })
    );
    expect(checkStillBooked.res.statusCode).toBe(200);
    expect(checkStillBooked.reply).toContain('no esta disponible');
  });

  test('audio human correction in same utterance keeps latest intent', async () => {
    const from = '595985570013';
    const sequence = [
      buildAudioPayload({
        from,
        id: 'hc-1',
        debugTranscript: 'hola quiero un turno',
      }),
      buildAudioPayload({
        from,
        id: 'hc-2',
        debugTranscript: 'quiero corte',
      }),
      buildAudioPayload({
        from,
        id: 'hc-3',
        debugTranscript: 'mañana no perdon el viernes a las 4',
        debugDurationSec: 6,
      }),
    ];

    for (const payload of sequence) {
      const { res } = await sendPayload(payload);
      expect(res.statusCode).toBe(200);
    }

    const lastReply = outboundMessages[outboundMessages.length - 1];
    expect(lastReply).toContain('A nombre de quien');
  });

  test('audio duplicate id, stale and out-of-order are controlled', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const from = '595985570014';

    const duplicatePayload = buildAudioPayload({
      from,
      id: 'dup-audio-1',
      timestamp: String(nowSec),
      debugTranscript: 'hola',
    });

    const first = await sendPayload(duplicatePayload);
    const second = await sendPayload(duplicatePayload);
    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(200);
    expect(second.res.body.reason).toBe('duplicate_event');

    const stale = await sendPayload(
      buildAudioPayload({
        from,
        id: 'stale-audio-1',
        timestamp: String(nowSec - 200000),
        debugTranscript: 'turno',
      })
    );
    expect(stale.res.statusCode).toBe(200);
    expect(stale.res.body.reason).toBe('stale_event');

    await sendPayload(
      buildAudioPayload({
        from,
        id: 'order-new-audio',
        timestamp: String(nowSec),
        debugTranscript: 'turno',
      })
    );
    const outOfOrder = await sendPayload(
      buildAudioPayload({
        from,
        id: 'order-old-audio',
        timestamp: String(nowSec - 1000),
        debugTranscript: 'turno',
      })
    );
    expect(outOfOrder.res.statusCode).toBe(200);
    expect(outOfOrder.res.body.reason).toBe('out_of_order_event');
  });

  test('long audio-only conversation (30 turns) remains coherent', async () => {
    const from = '595985570015';
    const turns = [
      'hola',
      'turno',
      'corte',
      '2099-12-31',
      '15:00',
      'Juan Perez',
      'efectivo',
      'confirmar',
      'gracias',
      'quiero otro turno',
      'barba',
      '2099-12-30',
      '10:00',
      'a nombre de Carla Duarte',
      'tarjeta',
      'confirmar',
      'reprogramar mi turno porfa',
      '2099-12-30 11:00',
      'cancelar',
      'turno',
      'perfilado de cejas',
      '2099-12-29',
      '14:00',
      'Mariela Ocampos',
      'transferencia',
      'confirmar',
      'hay turno el miercoles a las 11?',
      'gracias',
      'turno',
      'corte',
    ];

    for (let i = 0; i < turns.length; i += 1) {
      const payload = buildAudioPayload({
        from,
        id: `long-audio-${i}`,
        debugTranscript: turns[i],
        debugConfidence: 0.9,
      });
      const { res, reply, latencyMs } = await sendPayload(payload);
      expect(res.statusCode).toBe(200);
      expect(reply.toLowerCase()).not.toContain('undefined');
      expect(reply.toLowerCase()).not.toContain('null');
      recordCase({
        dimension: 'D',
        caseName: `long-audio-turn-${i + 1}`,
        input: turns[i],
        previousState: 'audio-only long session',
        expected: 'coherencia conversacional sin estado imposible',
        actual: reply,
        latencyMs,
        fallback: reply,
      });
    }
  });

  test('audio metrics expose low-confidence and clarification counters', async () => {
    const from = '595985570016';
    await sendPayload(
      buildAudioPayload({
        from,
        id: 'metric-audio-1',
        debugTranscript: 'turno',
        debugConfidence: 0.2,
      })
    );
    await sendPayload(
      buildAudioPayload({
        from,
        id: 'metric-audio-2',
        debugTranscript: 'cancelar turno',
        debugConfidence: 0.6,
      })
    );

    const metrics = await request(app).get('/metrics');
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body.audio).toBeTruthy();
    expect(metrics.body.audio.totals.total).toBeGreaterThan(0);
    expect(metrics.body.audio.totals.lowConfidence).toBeGreaterThan(0);
    expect(metrics.body.audio.totals.clarification).toBeGreaterThan(0);
  });

  test('audio fuzzing: mutated payloads never crash pipeline', async () => {
    function randomChoice(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    const fromBase = '5959855799';
    const mimeChoices = ['audio/ogg', 'audio/mp4', 'audio/webm', 'audio/flac', 'audio/wav'];
    const transcriptChoices = [
      '',
      'turno',
      'cancelar turno',
      'reprogramar mi turno',
      'hola@@###',
      'mañana no perdon viernes',
      'a nombre de juan perez',
    ];
    const flagChoices = [
      [],
      ['noise_only'],
      ['silence'],
      ['low_volume'],
      ['abrupt_cut'],
      ['clipping'],
      ['noise_only', 'silence'],
    ];

    for (let i = 0; i < 240; i += 1) {
      const payload = buildAudioPayload({
        from: `${fromBase}${String(100 + (i % 80))}`,
        id: `fuzz-audio-${i}`,
        mimeType: randomChoice(mimeChoices),
        debugTranscript: randomChoice(transcriptChoices),
        debugConfidence: Math.random(),
        debugDurationSec: Math.random() * 360,
        debugFlags: randomChoice(flagChoices),
        fileSize: Math.floor(Math.random() * 25 * 1024 * 1024),
      });

      const { res, reply, latencyMs } = await sendPayload(payload);
      expect(res.statusCode).toBe(200);
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(0);
      if (i < 120) {
        recordCase({
          dimension: 'Fuzz',
          caseName: `audio-fuzz-${i}`,
          input: payload.entry[0].changes[0].value.messages[0].audio,
          previousState: 'random',
          expected: 'sin crash y fallback controlado',
          actual: reply,
          latencyMs,
          fallback: reply,
        });
      }
    }
  });

  test('temporal consistency: same audio request yields equivalent logical decision', async () => {
    const audioText = 'quiero un turno para el martes a las 4';
    const userA = await sendPayload(
      buildAudioPayload({
        from: '595985570017',
        id: 'consistency-a-1',
        debugTranscript: audioText,
        debugConfidence: 0.93,
      })
    );
    const userB = await sendPayload(
      buildAudioPayload({
        from: '595985570018',
        id: 'consistency-b-1',
        debugTranscript: audioText,
        debugConfidence: 0.93,
      })
    );

    expect(userA.res.statusCode).toBe(200);
    expect(userB.res.statusCode).toBe(200);
    expect(userA.reply).toContain('Que servicio queres');
    expect(userB.reply).toContain('Que servicio queres');
    recordCase({
      dimension: 'Temporal',
      caseName: 'same-audio-same-decision',
      input: audioText,
      previousState: 'dos usuarios en idle',
      expected: 'misma decision logica',
      actual: `${userA.reply} || ${userB.reply}`,
      latencyMs: Math.max(userA.latencyMs, userB.latencyMs),
      fallback: 'none',
    });
  });
});
