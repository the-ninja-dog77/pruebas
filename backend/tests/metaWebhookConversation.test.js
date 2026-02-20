const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = `zzeta.meta.${Date.now()}.db`;
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_TOKEN = 'test_token';
process.env.WHATSAPP_GRAPH_VERSION = 'v24.0';

const app = require('../index');

describe('WhatsApp webhook conversation flow', () => {
  const outboundMessages = [];

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

  function messagePayload(text, from = '595985544421') {
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

  test('advances from intent to confirmation', async () => {
    const sequence = [
      'hola',
      'turno',
      'corte de pelo',
      '31/12/2099',
      '15:00',
      'confirmar',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, '595985544421'));

      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[0]).toContain('escribi "turno"');
    expect(outboundMessages[1]).toContain('Que servicio queres');
    expect(outboundMessages[2]).toContain('Para que fecha queres');
    expect(outboundMessages[3]).toContain('Horarios disponibles para 2099-12-31');
    expect(outboundMessages[4]).toContain('Si queres confirmar, responde "confirmar"');
    expect(outboundMessages[5]).toContain('turno confirmado');
  });

  test('does not confirm when user says no', async () => {
    const sequence = [
      'turno',
      'corte',
      '30/12/2099',
      '15:00',
      'y si no quiero?',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, '595985544422'));

      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('No se confirmo todavia');
  });

  test('asks for date when availability is requested from idle', async () => {
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('que horarios manejas?', '595985544423'));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Decime la fecha');
  });

  test('detects slot occupied when panel already booked that hour', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });

    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const fecha = '2099-12-31';
    const createFromPanel = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora: '10:00',
        servicio: 'Corte',
        precio: 30000,
      });

    expect(createFromPanel.statusCode).toBe(201);

    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`hay turno el ${fecha} a las 10?`, '595985544424'));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('no esta disponible');
  });

  test('reassures availability on follow-up "seguro?" before selecting service', async () => {
    const from = '595985544425';
    const fecha = '2099-12-31';

    const first = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`hola tienes un turno el ${fecha} a las 09:00?`, from));

    expect(first.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('esta disponible');

    const second = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('seguro?', from));

    expect(second.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('sigue disponible');
  });

  test('rejects past date before asking for hour', async () => {
    const from = '595985544426';

    const sequence = [
      'turno',
      'corte',
      '2000-01-01',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));

      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('fecha ya paso');
  });

  test('returns past-date message when asking availability for an old date', async () => {
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('hay horarios para 2000-01-01?', '595985544427'));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('ya paso');
  });
});
