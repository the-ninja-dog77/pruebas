describe('whatsappSender.service', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
    delete global.fetch;
  });

  test('returns config error for missing Meta credentials', () => {
    process.env.WHATSAPP_PROVIDER = 'meta';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '';
    process.env.WHATSAPP_TOKEN = '';

    const sender = require('../services/whatsappSender.service');
    expect(sender.getOutboundConfigError()).toMatch(/WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_TOKEN/);
  });

  test('retries on transient Gupshup 5xx and then succeeds', async () => {
    process.env.WHATSAPP_PROVIDER = 'gupshup';
    process.env.GUPSHUP_API_KEY = 'k-test';
    process.env.GUPSHUP_SOURCE = '917834811114';
    process.env.WHATSAPP_OUTBOUND_RETRIES = '1';
    process.env.WHATSAPP_OUTBOUND_TIMEOUT_MS = '5000';

    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => '{"message":"temporary"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ messageId: 'ok-1' }),
      });

    const sender = require('../services/whatsappSender.service');
    const result = await sender.sendTextMessage('595985544421', 'hola');

    expect(result.ok).toBe(true);
    expect(result.payload.messageId).toBe('ok-1');
    expect(Number(result.retries)).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('returns error on non-retriable auth status', async () => {
    process.env.WHATSAPP_PROVIDER = 'gupshup';
    process.env.GUPSHUP_API_KEY = 'bad-key';
    process.env.GUPSHUP_SOURCE = '917834811114';
    process.env.WHATSAPP_OUTBOUND_RETRIES = '2';
    process.env.WHATSAPP_OUTBOUND_TIMEOUT_MS = '5000';

    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"Authentication Failed"}',
    });

    const sender = require('../services/whatsappSender.service');
    const result = await sender.sendTextMessage('595985544421', 'hola');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(Number(result.retries)).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
