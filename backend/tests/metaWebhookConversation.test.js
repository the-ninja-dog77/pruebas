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

  afterAll(() => {
    jest.restoreAllMocks();
  });

  function messagePayload(text) {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '595985544421',
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
        .send(messagePayload(msg));

      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[0]).toContain('escribi "turno"');
    expect(outboundMessages[1]).toContain('Que servicio queres');
    expect(outboundMessages[2]).toContain('Para que fecha queres');
    expect(outboundMessages[3]).toContain('Horarios disponibles para 2099-12-31');
    expect(outboundMessages[4]).toContain('Si queres confirmar, responde "confirmar"');
    expect(outboundMessages[5]).toContain('turno confirmado');
  });
});
