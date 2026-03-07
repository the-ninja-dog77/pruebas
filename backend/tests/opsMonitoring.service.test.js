describe('opsMonitoring alerts', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.OPS_MONITOR_WINDOW_MS = '60000';
    process.env.OPS_ALERT_ERROR_RATE_PCT = '5';
    process.env.OPS_ALERT_P95_MS = '1200';
    process.env.OPS_ALERT_RSS_MB = '99999';
    process.env.OPS_ALERT_OUTBOUND_FAIL_COUNT = '2';
    process.env.OPS_ALERT_WEBHOOK_FAIL_COUNT = '2';
    process.env.OPS_ALERT_PROVIDER_DOWN_FAIL_COUNT = '2';
    process.env.OPS_ALERT_PROVIDER_DOWN_FAIL_RATE_PCT = '90';
    process.env.OPS_ALERT_COOLDOWN_MS = '0';
  });

  test('raises webhook failures and provider down alerts', async () => {
    const ops = require('../services/opsMonitoring.service');

    ops.recordWebhook({ path: '/meta-webhook', status: 500, latencyMs: 1800 });
    ops.recordWebhook({ path: '/meta-webhook', status: 503, latencyMs: 1900 });

    ops.recordOutboundResult({
      provider: 'gupshup',
      status: 503,
      ok: false,
      reason: 'provider timeout',
    });
    ops.recordOutboundResult({
      provider: 'gupshup',
      status: 500,
      ok: false,
      reason: 'provider down',
    });

    const alerts = await ops.runAlertCycle();
    const keys = alerts.map(a => a.key);

    expect(keys).toContain('webhook_failures_count');
    expect(keys).toContain('provider_down_gupshup');

    const snapshot = ops.getSnapshot();
    expect(snapshot.outbound.byProvider.gupshup.failureCount).toBe(2);
    expect(snapshot.outbound.byProvider.gupshup.failureRatePct).toBeGreaterThanOrEqual(90);
  });
});
