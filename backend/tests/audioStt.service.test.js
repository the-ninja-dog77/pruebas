process.env.NODE_ENV = 'test';

function buildHeaders(contentType = 'audio/ogg') {
  return {
    get: key => (String(key || '').toLowerCase() === 'content-type' ? contentType : null),
  };
}

function mockResponse({
  ok = true,
  status = 200,
  jsonBody = {},
  textBody = '',
  arrayBufferBody = Buffer.from('audio-bytes'),
  contentType = 'audio/ogg',
} = {}) {
  return {
    ok,
    status,
    headers: buildHeaders(contentType),
    json: async () => jsonBody,
    text: async () => textBody,
    arrayBuffer: async () => arrayBufferBody,
  };
}

describe('audioStt.service hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.GROQ_API_KEY = 'gsk_test_key';
    process.env.WHATSAPP_GRAPH_VERSION = 'v24.0';
    process.env.AUDIO_STT_RETRIES = '1';
    process.env.AUDIO_MEDIA_METADATA_RETRIES = '1';
    process.env.AUDIO_MEDIA_DOWNLOAD_RETRIES = '1';
    process.env.AUDIO_RETRY_BACKOFF_MS = '1';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  test('uses default Groq base URL when GROQ_BASE_URL points to console/keys page', async () => {
    process.env.GROQ_BASE_URL = 'https://console.groq.com/keys';
    const service = require('../services/audioStt.service');

    global.fetch.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/v24.0/media-1')) {
        return mockResponse({
          jsonBody: { url: 'https://lookaside.whatsapp.test/media.bin', mime_type: 'audio/ogg' },
        });
      }
      if (target === 'https://lookaside.whatsapp.test/media.bin') {
        return mockResponse({
          arrayBufferBody: Buffer.from('abc123'),
          contentType: 'audio/ogg',
        });
      }
      if (target.includes('api.groq.com/openai/v1/audio/transcriptions')) {
        return mockResponse({
          jsonBody: { text: 'hola desde audio' },
        });
      }
      return mockResponse({ ok: false, status: 500, textBody: 'unexpected url' });
    });

    const result = await service.transcribeFromWhatsAppMedia({
      mediaId: 'media-1',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
      phoneNumberId: '1029037640285604',
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('hola');
    expect(
      global.fetch.mock.calls.some(call =>
        String(call[0]).includes('api.groq.com/openai/v1/audio/transcriptions')
      )
    ).toBe(true);
    expect(
      global.fetch.mock.calls.some(call =>
        String(call[0]).includes('phone_number_id=1029037640285604')
      )
    ).toBe(true);
  });

  test('returns media_auth_error when metadata endpoint responds 401', async () => {
    const service = require('../services/audioStt.service');

    global.fetch.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 401,
        textBody: 'invalid token',
      })
    );
    global.fetch.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 401,
        textBody: 'invalid token retry',
      })
    );

    const result = await service.transcribeFromWhatsAppMedia({
      mediaId: 'media-401',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('media_auth_error');
    expect(result.failureType).toBe('audio');
  });

  test('returns media_url_expired_or_not_found when media download URL responds 404', async () => {
    const service = require('../services/audioStt.service');

    global.fetch.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/v24.0/media-404')) {
        return mockResponse({
          jsonBody: { url: 'https://lookaside.whatsapp.test/missing.bin', mime_type: 'audio/ogg' },
        });
      }
      if (target === 'https://lookaside.whatsapp.test/missing.bin') {
        return mockResponse({
          ok: false,
          status: 404,
          textBody: 'not found',
        });
      }
      return mockResponse({ ok: false, status: 500, textBody: 'unexpected url' });
    });

    const result = await service.transcribeFromWhatsAppMedia({
      mediaId: 'media-404',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('media_url_expired_or_not_found');
  });

  test('refreshes media URL after 404 and succeeds when second URL is valid', async () => {
    const service = require('../services/audioStt.service');
    let metadataCalls = 0;
    let sttCalls = 0;

    global.fetch.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/v24.0/media-refresh')) {
        metadataCalls += 1;
        if (metadataCalls === 1) {
          return mockResponse({
            jsonBody: { url: 'https://lookaside.whatsapp.test/expired.bin', mime_type: 'audio/ogg' },
          });
        }
        return mockResponse({
          jsonBody: { url: 'https://lookaside.whatsapp.test/fresh.bin', mime_type: 'audio/ogg' },
        });
      }
      if (target === 'https://lookaside.whatsapp.test/expired.bin') {
        return mockResponse({
          ok: false,
          status: 404,
          textBody: 'expired',
        });
      }
      if (target === 'https://lookaside.whatsapp.test/fresh.bin') {
        return mockResponse({
          arrayBufferBody: Buffer.from('fresh-bytes'),
          contentType: 'audio/ogg',
        });
      }
      if (target.includes('/audio/transcriptions')) {
        sttCalls += 1;
        return mockResponse({
          jsonBody: { text: 'audio recuperado' },
        });
      }
      return mockResponse({ ok: false, status: 500, textBody: 'unexpected url' });
    });

    const result = await service.transcribeFromWhatsAppMedia({
      mediaId: 'media-refresh',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('audio recuperado');
    expect(metadataCalls).toBe(2);
    expect(sttCalls).toBe(1);
  });

  test('media-url pipeline retries without custom headers when first attempt fails', async () => {
    process.env.AUDIO_MEDIA_DOWNLOAD_RETRIES = '0';
    const service = require('../services/audioStt.service');
    let downloadCalls = 0;

    global.fetch.mockImplementation(async (url, opts = {}) => {
      const target = String(url);
      if (target === 'https://media.gupshup.test/audio.ogg') {
        downloadCalls += 1;
        if (opts?.headers?.apikey) {
          return mockResponse({
            ok: false,
            status: 403,
            textBody: 'forbidden with custom header',
          });
        }
        return mockResponse({
          arrayBufferBody: Buffer.from('audio-ok'),
          contentType: 'audio/ogg',
        });
      }
      if (target.includes('/audio/transcriptions')) {
        return mockResponse({
          jsonBody: { text: 'audio por fallback headers' },
        });
      }
      return mockResponse({ ok: false, status: 500, textBody: 'unexpected url' });
    });

    const result = await service.transcribeFromMediaUrl({
      mediaUrl: 'https://media.gupshup.test/audio.ogg',
      requestHeaders: { apikey: 'gup_key' },
      mimeTypeHint: 'audio/ogg',
      filenameHint: 'test.ogg',
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('audio por fallback headers');
    expect(downloadCalls).toBe(2);
  });

  test('media-url pipeline retries with fallback bearer token when available', async () => {
    process.env.AUDIO_MEDIA_DOWNLOAD_RETRIES = '0';
    const service = require('../services/audioStt.service');
    let downloadCalls = 0;

    global.fetch.mockImplementation(async (url, opts = {}) => {
      const target = String(url);
      if (target === 'https://media.gupshup.test/audio-token.ogg') {
        downloadCalls += 1;
        if (opts?.headers?.Authorization === 'Bearer wa_fallback_token') {
          return mockResponse({
            arrayBufferBody: Buffer.from('audio-token-ok'),
            contentType: 'audio/ogg',
          });
        }
        return mockResponse({
          ok: false,
          status: 403,
          textBody: 'forbidden until fallback token',
        });
      }
      if (target.includes('/audio/transcriptions')) {
        return mockResponse({
          jsonBody: { text: 'audio por fallback token' },
        });
      }
      return mockResponse({ ok: false, status: 500, textBody: 'unexpected url' });
    });

    const result = await service.transcribeFromMediaUrl({
      mediaUrl: 'https://media.gupshup.test/audio-token.ogg',
      requestHeaders: { apikey: 'gup_key' },
      fallbackAccessToken: 'wa_fallback_token',
      mimeTypeHint: 'audio/ogg',
      filenameHint: 'test-token.ogg',
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('audio por fallback token');
    expect(downloadCalls).toBe(3);
  });

  test('returns stt_auth_error when Groq returns 401', async () => {
    const service = require('../services/audioStt.service');

    global.fetch.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/v24.0/media-auth')) {
        return mockResponse({
          jsonBody: { url: 'https://lookaside.whatsapp.test/media-auth.bin', mime_type: 'audio/ogg' },
        });
      }
      if (target === 'https://lookaside.whatsapp.test/media-auth.bin') {
        return mockResponse({
          arrayBufferBody: Buffer.from('abc123'),
          contentType: 'audio/ogg',
        });
      }
      if (target.includes('/audio/transcriptions')) {
        return mockResponse({
          ok: false,
          status: 401,
          textBody: 'invalid groq key',
        });
      }
      return mockResponse({ ok: false, status: 500, textBody: 'unexpected url' });
    });

    const result = await service.transcribeFromWhatsAppMedia({
      mediaId: 'media-auth',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('stt_auth_error');
    expect(result.failureType).toBe('stt');
  });

  test('retries STT on 5xx and succeeds on next attempt', async () => {
    const service = require('../services/audioStt.service');
    let sttCallCount = 0;

    global.fetch.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/v24.0/media-retry')) {
        return mockResponse({
          jsonBody: { url: 'https://lookaside.whatsapp.test/media-retry.bin', mime_type: 'audio/ogg' },
        });
      }
      if (target === 'https://lookaside.whatsapp.test/media-retry.bin') {
        return mockResponse({
          arrayBufferBody: Buffer.from('abc123'),
          contentType: 'audio/ogg',
        });
      }
      if (target.includes('/audio/transcriptions')) {
        sttCallCount += 1;
        if (sttCallCount === 1) {
          return mockResponse({
            ok: false,
            status: 500,
            textBody: 'temporary failure',
          });
        }
        return mockResponse({
          jsonBody: { text: 'turno confirmado' },
        });
      }
      return mockResponse({ ok: false, status: 500, textBody: 'unexpected url' });
    });

    const result = await service.transcribeFromWhatsAppMedia({
      mediaId: 'media-retry',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('turno confirmado');
    expect(result.retries).toBeGreaterThan(0);
    expect(sttCallCount).toBe(2);
  });
});
