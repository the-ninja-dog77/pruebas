const logger = require('../logger');

const WINDOW_MS = Number(process.env.OPS_MONITOR_WINDOW_MS || 5 * 60 * 1000);
const ALERT_CHECK_INTERVAL_MS = Number(
  process.env.OPS_ALERT_CHECK_INTERVAL_MS || 60 * 1000
);
const ALERT_COOLDOWN_MS = Number(process.env.OPS_ALERT_COOLDOWN_MS || 10 * 60 * 1000);
const ERROR_RATE_THRESHOLD_PCT = Number(process.env.OPS_ALERT_ERROR_RATE_PCT || 5);
const WEBHOOK_P95_THRESHOLD_MS = Number(process.env.OPS_ALERT_P95_MS || 1200);
const RSS_THRESHOLD_MB = Number(process.env.OPS_ALERT_RSS_MB || 450);
const OUTBOUND_FAIL_THRESHOLD = Number(process.env.OPS_ALERT_OUTBOUND_FAIL_COUNT || 10);
const WEBHOOK_FAIL_THRESHOLD = Number(process.env.OPS_ALERT_WEBHOOK_FAIL_COUNT || 25);
const PROVIDER_DOWN_FAIL_THRESHOLD = Number(
  process.env.OPS_ALERT_PROVIDER_DOWN_FAIL_COUNT || 8
);
const PROVIDER_DOWN_FAIL_RATE_PCT = Number(
  process.env.OPS_ALERT_PROVIDER_DOWN_FAIL_RATE_PCT || 95
);
const ALERT_WEBHOOK_URL = String(process.env.OPS_ALERT_WEBHOOK_URL || '').trim();
const ALERT_WEBHOOK_TOKEN = String(process.env.OPS_ALERT_WEBHOOK_TOKEN || '').trim();

const webhookSamples = [];
const outboundFailures = [];
const outboundResults = [];
const lastAlertByKey = new Map();
let latestAlerts = [];

function nowMs() {
  return Date.now();
}

function cleanupWindow(list, cutoff) {
  while (list.length && list[0].at < cutoff) {
    list.shift();
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function recordWebhook({ path, status, latencyMs }) {
  const at = nowMs();
  webhookSamples.push({
    at,
    path: String(path || ''),
    status: Number(status || 0),
    latencyMs: Number(latencyMs || 0),
  });
  cleanupWindow(webhookSamples, at - WINDOW_MS);
}

function recordOutboundFailure({ provider, status, reason }) {
  recordOutboundResult({
    provider,
    status,
    ok: false,
    reason,
  });
}

function recordOutboundResult({ provider, status, ok, reason }) {
  const at = nowMs();
  const normalizedProvider = String(provider || 'unknown');
  const normalizedStatus = Number(status || 0);
  const normalizedOk = Boolean(ok);
  const normalizedReason = String(reason || '');

  outboundResults.push({
    at,
    provider: normalizedProvider,
    status: normalizedStatus,
    ok: normalizedOk,
    reason: normalizedReason,
  });
  cleanupWindow(outboundResults, at - WINDOW_MS);

  if (normalizedOk) return;

  outboundFailures.push({
    at,
    provider: normalizedProvider,
    status: normalizedStatus,
    reason: normalizedReason,
  });
  cleanupWindow(outboundFailures, at - WINDOW_MS);
}

function getSnapshot() {
  const now = nowMs();
  const cutoff = now - WINDOW_MS;
  cleanupWindow(webhookSamples, cutoff);
  cleanupWindow(outboundFailures, cutoff);
  cleanupWindow(outboundResults, cutoff);

  const total = webhookSamples.length;
  const errors = webhookSamples.filter(s => s.status >= 500).length;
  const errorRatePct = total ? Number(((errors / total) * 100).toFixed(2)) : 0;
  const latencyValues = webhookSamples.map(s => Number(s.latencyMs || 0));
  const statusCounts = webhookSamples.reduce((acc, item) => {
    const key = String(item.status || 0);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const outboundByProvider = outboundResults.reduce((acc, item) => {
    const key = item.provider || 'unknown';
    if (!acc[key]) {
      acc[key] = {
        total: 0,
        successCount: 0,
        failureCount: 0,
        failureRatePct: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
      };
    }
    acc[key].total += 1;
    if (item.ok) {
      acc[key].successCount += 1;
      acc[key].lastSuccessAt = item.at;
    } else {
      acc[key].failureCount += 1;
      acc[key].lastFailureAt = item.at;
    }
    return acc;
  }, {});
  Object.keys(outboundByProvider).forEach(provider => {
    const item = outboundByProvider[provider];
    item.failureRatePct = item.total
      ? Number(((item.failureCount / item.total) * 100).toFixed(2))
      : 0;
  });
  const memory = process.memoryUsage();
  const outboundTotal = outboundResults.length;
  const outboundFailureCount = outboundFailures.length;
  const outboundSuccessCount = outboundTotal - outboundFailureCount;

  return {
    windowMs: WINDOW_MS,
    webhook: {
      total,
      errors,
      errorRatePct,
      failureCount: errors,
      statusCounts,
      latencyMs: {
        p50: Number(percentile(latencyValues, 50).toFixed(2)),
        p95: Number(percentile(latencyValues, 95).toFixed(2)),
        p99: Number(percentile(latencyValues, 99).toFixed(2)),
      },
    },
    outbound: {
      total: outboundTotal,
      successCount: outboundSuccessCount,
      failureCount: outboundFailureCount,
      failureRatePct: outboundTotal
        ? Number(((outboundFailureCount / outboundTotal) * 100).toFixed(2))
        : 0,
      byProvider: outboundByProvider,
    },
    system: {
      rssMb: Number((memory.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((memory.heapUsed / (1024 * 1024)).toFixed(2)),
      uptimeSec: Number(process.uptime().toFixed(2)),
    },
  };
}

function evaluateAlerts(snapshot) {
  const alerts = [];

  if (snapshot.webhook.errorRatePct > ERROR_RATE_THRESHOLD_PCT) {
    alerts.push({
      key: 'webhook_error_rate',
      severity: 'critical',
      message: `Webhook errorRate ${snapshot.webhook.errorRatePct}% > ${ERROR_RATE_THRESHOLD_PCT}%`,
    });
  }

  if (snapshot.webhook.latencyMs.p95 > WEBHOOK_P95_THRESHOLD_MS) {
    alerts.push({
      key: 'webhook_latency_p95',
      severity: 'warning',
      message: `Webhook p95 ${snapshot.webhook.latencyMs.p95}ms > ${WEBHOOK_P95_THRESHOLD_MS}ms`,
    });
  }

  if (snapshot.outbound.failureCount >= OUTBOUND_FAIL_THRESHOLD) {
    alerts.push({
      key: 'outbound_failures',
      severity: 'critical',
      message: `Outbound failures ${snapshot.outbound.failureCount} in last ${(WINDOW_MS / 60000).toFixed(1)}m`,
    });
  }

  if (snapshot.system.rssMb > RSS_THRESHOLD_MB) {
    alerts.push({
      key: 'memory_rss',
      severity: 'warning',
      message: `RSS ${snapshot.system.rssMb}MB > ${RSS_THRESHOLD_MB}MB`,
    });
  }

  if (snapshot.webhook.failureCount >= WEBHOOK_FAIL_THRESHOLD) {
    alerts.push({
      key: 'webhook_failures_count',
      severity: 'critical',
      message: `Webhook 5xx ${snapshot.webhook.failureCount} > ${WEBHOOK_FAIL_THRESHOLD} in ${(WINDOW_MS / 60000).toFixed(1)}m`,
    });
  }

  Object.entries(snapshot.outbound.byProvider || {}).forEach(([provider, stats]) => {
    if (
      Number(stats.failureCount || 0) >= PROVIDER_DOWN_FAIL_THRESHOLD &&
      Number(stats.failureRatePct || 0) >= PROVIDER_DOWN_FAIL_RATE_PCT
    ) {
      alerts.push({
        key: `provider_down_${provider}`,
        severity: 'critical',
        message: `Provider ${provider} degraded: ${stats.failureCount} fails (${stats.failureRatePct}% fail rate) in ${(WINDOW_MS / 60000).toFixed(1)}m`,
      });
    }
  });

  return alerts;
}

async function notifyWebhook(alert) {
  if (!ALERT_WEBHOOK_URL) return;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (ALERT_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${ALERT_WEBHOOK_TOKEN}`;
  }

  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'zzeta-backend',
        kind: 'ops_alert',
        alert,
        at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    logger.warn(`OPS alert webhook notify failed: ${err.message}`);
  }
}

async function runAlertCycle() {
  const snapshot = getSnapshot();
  const alerts = evaluateAlerts(snapshot);
  latestAlerts = alerts;
  if (!alerts.length) return alerts;

  const now = nowMs();
  for (const alert of alerts) {
    const lastAt = Number(lastAlertByKey.get(alert.key) || 0);
    if (now - lastAt < ALERT_COOLDOWN_MS) continue;

    lastAlertByKey.set(alert.key, now);
    logger.warn(`OPS ALERT [${alert.severity}] ${alert.message}`);
    await notifyWebhook(alert);
  }

  return alerts;
}

function getLatestAlerts() {
  return latestAlerts;
}

module.exports = {
  ALERT_CHECK_INTERVAL_MS,
  recordWebhook,
  recordOutboundFailure,
  recordOutboundResult,
  getSnapshot,
  runAlertCycle,
  getLatestAlerts,
};
