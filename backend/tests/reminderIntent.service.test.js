const reminderIntent = require('../services/reminderIntent.service');

describe('reminderIntent.service', () => {
  test('builds a broad lexicon (500+ variants)', () => {
    const stats = reminderIntent.getReminderLexiconStats();

    expect(stats.confirmVariants).toBeGreaterThanOrEqual(500);
    expect(stats.cancelVariants).toBeGreaterThanOrEqual(500);
    expect(stats.totalVariants).toBeGreaterThanOrEqual(1000);
  });

  test('detects natural confirmation phrases', () => {
    const result = reminderIntent.resolveReminderIntent('dale rey, ahi voy sin falta');
    expect(result.intent).toBe('confirm');
  });

  test('detects natural cancellation phrases', () => {
    const result = reminderIntent.resolveReminderIntent(
      'perdon bro, no voy a poder, mejor otro dia'
    );
    expect(result.intent).toBe('cancel');
  });

  test('prioritizes cancellation when sentence has mixed signals', () => {
    const result = reminderIntent.resolveReminderIntent(
      'si pero no voy a llegar, cancelame porfa'
    );
    expect(result.intent).toBe('cancel');
  });

  test('returns unknown for unrelated text', () => {
    const result = reminderIntent.resolveReminderIntent('hola, quiero saber horarios');
    expect(result.intent).toBe('unknown');
  });
});
