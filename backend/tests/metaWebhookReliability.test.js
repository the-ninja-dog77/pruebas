const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = `zzeta.reliability.${Date.now()}.db`;
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_TOKEN = 'test_token';
process.env.WHATSAPP_GRAPH_VERSION = 'v24.0';
process.env.BOT_MIN_LEAD_MINUTES = '0';
delete process.env.GROQ_API_KEY;
delete process.env.OPENAI_API_KEY;

const app = require('../index');

describe('WhatsApp webhook reliability matrix', () => {
  const outboundMessages = [];
  let requestCounter = 0;

  beforeAll(() => {
    global.fetch = jest.fn(async (_url, opts) => {
      const payload = JSON.parse(opts.body);
      outboundMessages.push(payload.text.body);

      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.test' }] }),
        text: async () => '',
      };
    });
  });

  beforeEach(() => {
    outboundMessages.length = 0;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  function messagePayload(text, from = '595985544500') {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
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

  function nextIp() {
    requestCounter += 1;
    const octet = requestCounter % 250;
    return `10.33.0.${octet}`;
  }

  async function sendMessage(text, from) {
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', nextIp())
      .send(messagePayload(text, from));

    const reply = outboundMessages[outboundMessages.length - 1] || '';
    return { res, reply };
  }

  async function loginBarber() {
    const login = await request(app).post('/auth/login').send({
      username: 'gonzabarber',
      password: 'barber312',
    });
    expect(login.statusCode).toBe(200);
    expect(login.body.token).toBeTruthy();
    return login.body.token;
  }

  test('accepts slang + natural hour and completes booking', async () => {
    const from = '595985544501';
    const sequence = [
      'hola bro',
      'quiero un turno',
      'quiero un corte',
      'martes',
      'quiero el turno de las 4',
      'Fernando Vallejos',
      'efectivo',
      'confirmar',
    ];

    for (const msg of sequence) {
      const { res } = await sendMessage(msg, from);
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('turno confirmado');
  });

  test('thanks while waiting for hour keeps flow and gives contextual guidance', async () => {
    const from = '595985544502';
    const sequence = ['turno', 'corte', '2099-12-31'];

    for (const msg of sequence) {
      const { res } = await sendMessage(msg, from);
      expect(res.statusCode).toBe(200);
    }

    const thanks = await sendMessage('gracias entonces', from);
    expect(thanks.res.statusCode).toBe(200);
    expect(thanks.reply).toContain('De nada');
    expect(thanks.reply).toContain('Seguimos');

    const restart = await sendMessage('turno', from);
    expect(restart.res.statusCode).toBe(200);
    expect(restart.reply).toContain('Decime la hora');
  });

  test('natural reschedule command takes over even in another flow state', async () => {
    const from = '595985544503';
    const fecha = '2099-12-30';
    const createBooking = ['turno', 'corte', fecha, '15:00', 'Diego Acuna', 'tarjeta', 'confirmar'];

    for (const msg of createBooking) {
      const { res } = await sendMessage(msg, from);
      expect(res.statusCode).toBe(200);
    }

    const triggerBusy = await sendMessage(`corte ${fecha} 15:00`, from);
    expect(triggerBusy.res.statusCode).toBe(200);
    expect(triggerBusy.reply).toContain('Ya tenes un turno activo');

    const reschedule = await sendMessage('reprogramar mi turno porfa', from);
    expect(reschedule.res.statusCode).toBe(200);
    expect(reschedule.reply).toContain('Encontre tu proximo turno');
  });

  test('out-of-scope question in idle stays constrained when AI is disabled', async () => {
    const from = '595985544504';
    const outOfScope = await sendMessage('quien gano el mundial 2022?', from);
    expect(outOfScope.res.statusCode).toBe(200);
    expect(outOfScope.reply).toContain('Puedo ayudarte a reservar');
  });

  test('closed day reports no availability', async () => {
    const from = '595985544505';
    const sequence = ['turno', 'corte', '2099-12-27'];

    for (const msg of sequence) {
      const { res } = await sendMessage(msg, from);
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('no quedan horarios disponibles');
  });

  test('one active booking rule blocks second booking unless explicitly for another person', async () => {
    const from = '595985544506';
    const fecha = '2099-12-29';
    const first = ['turno', 'corte', fecha, '10:00', 'Luis Gomez', 'efectivo', 'confirmar'];

    for (const msg of first) {
      const { res } = await sendMessage(msg, from);
      expect(res.statusCode).toBe(200);
    }

    const blocked = await sendMessage('necesito corte 2099-12-29 11:00', from);
    expect(blocked.res.statusCode).toBe(200);
    expect(blocked.reply).toContain('Ya tenes un turno activo');

    const explicit = await sendMessage('a nombre de Carla Duarte', from);
    expect(explicit.res.statusCode).toBe(200);
    expect(explicit.reply).toContain('metodo de pago');
  });

  test('bot disabled mode ignores inbound without trying outbound send', async () => {
    const token = await loginBarber();
    const initialOutboundCount = outboundMessages.length;

    const disable = await request(app)
      .patch('/api/barber-panel/bot-status')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });
    expect(disable.statusCode).toBe(200);
    expect(disable.body.enabled).toBe(false);

    const disabledInbound = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', nextIp())
      .send(messagePayload('hola bot apagado?', '595985544507'));

    expect(disabledInbound.statusCode).toBe(200);
    expect(disabledInbound.body.reason).toBe('bot_disabled');
    expect(outboundMessages.length).toBe(initialOutboundCount);

    const enable = await request(app)
      .patch('/api/barber-panel/bot-status')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });
    expect(enable.statusCode).toBe(200);
    expect(enable.body.enabled).toBe(true);
  });

  test('stress: mixed 250-message load keeps webhook stable', async () => {
    const userPool = Array.from({ length: 30 }).map((_, i) => `59598555${String(600 + i)}`);
    const corpus = [
      'hola',
      'turno',
      'corte',
      'barba',
      'perfilado de cejas',
      'manana',
      'martes',
      'miercoles',
      '2099-12-31',
      'quiero el turno de las 3',
      '15:00',
      'efectivo',
      'transferencia',
      'tarjeta',
      'confirmar',
      'gracias',
      'cancelar',
      'reprogramar mi turno porfa',
      'quiero otro turno',
      'a nombre de Maria Lopez',
      'quien gano el mundial 2022?',
      'hay turno el miercoles a las 11?',
    ];

    for (let i = 0; i < 250; i += 1) {
      const from = userPool[i % userPool.length];
      const msg = corpus[i % corpus.length];
      const { res, reply } = await sendMessage(msg, from);
      expect(res.statusCode).toBe(200);
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(0);
    }
  });
});
