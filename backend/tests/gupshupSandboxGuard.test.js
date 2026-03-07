const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = `zzeta.gupshup-sandbox.${Date.now()}.db`;
process.env.WHATSAPP_PROVIDER = 'gupshup';
process.env.GUPSHUP_API_KEY = 'gup_test_key';
process.env.GUPSHUP_SOURCE = '595985500000';
process.env.GROQ_API_KEY = '';

const app = require('../index');

describe('Gupshup sandbox proxy guard', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'submitted' }),
      text: async () => '',
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('ignores known sandbox proxy keyword noise', async () => {
    const payload = {
      payload: {
        type: 'text',
        source: '595985511111',
        id: 'gup-msg-1',
        timestamp: String(Math.floor(Date.now() / 1000)),
        payload: {
          text: 'Sorry no such keyword, please use one of the following keywords.',
        },
      },
    };

    const res = await request(app)
      .post('/gupshup-webhook')
      .set('Content-Type', 'application/json')
      .set('x-webhook-debug', '1')
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe('gupshup_sandbox_proxy_message');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
