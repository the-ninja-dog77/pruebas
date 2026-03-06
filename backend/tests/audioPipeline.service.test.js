process.env.NODE_ENV = 'test';

jest.mock('../services/audioStt.service', () => ({
  transcribeFromWhatsAppMedia: jest.fn(),
  transcribeFromMediaUrl: jest.fn(),
}));

jest.mock('../services/audioObservability.service', () => ({
  record: jest.fn(),
  recordQueueDepth: jest.fn(),
  recordQueueRejection: jest.fn(),
  recordQueueTimeout: jest.fn(),
}));

const audioStt = require('../services/audioStt.service');
const audioPipeline = require('../services/audioPipeline.service');

describe('audioPipeline gupshup compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses media_url for gupshup audio even if id is present', async () => {
    audioStt.transcribeFromMediaUrl.mockResolvedValueOnce({
      ok: true,
      text: 'turno',
      confidence: 0.91,
      retries: 0,
    });

    const result = await audioPipeline.processAudioMessage({
      incoming: {
        type: 'audio',
        audio: {
          id: 'not-meta-media-id',
          media_url: 'https://media.gupshup.io/audio/test.ogg',
          mime_type: 'audio/ogg',
          duration_sec: 2,
        },
      },
      from: '595985544421',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
      phoneNumberId: '123',
      provider: 'gupshup',
      mediaRequestHeaders: { apikey: 'gup_key' },
      buildReply: async () => 'ok reply',
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('audio_processed');
    expect(audioStt.transcribeFromMediaUrl).toHaveBeenCalledTimes(1);
    const callArgs = audioStt.transcribeFromMediaUrl.mock.calls[0][0];
    expect(callArgs.accessToken).toBeUndefined();
    expect(callArgs.requestHeaders).toEqual({ apikey: 'gup_key' });
    expect(audioStt.transcribeFromWhatsAppMedia).not.toHaveBeenCalled();
  });

  test('returns specific fallback when gupshup audio arrives without media_url', async () => {
    const result = await audioPipeline.processAudioMessage({
      incoming: {
        type: 'audio',
        audio: {
          id: 'gupshup-only-id',
          mime_type: 'audio/ogg',
          duration_sec: 2,
        },
      },
      from: '595985544421',
      accessToken: 'wa_token',
      graphVersion: 'v24.0',
      phoneNumberId: '123',
      provider: 'gupshup',
      buildReply: async () => 'ok reply',
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('missing_media_url_gupshup');
    expect(result.reply).toContain('Gupshup Sandbox');
    expect(audioStt.transcribeFromMediaUrl).not.toHaveBeenCalled();
    expect(audioStt.transcribeFromWhatsAppMedia).not.toHaveBeenCalled();
  });
});
