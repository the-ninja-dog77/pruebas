#!/usr/bin/env node
/* eslint-disable no-console */
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { monitorEventLoopDelay } = require('node:perf_hooks');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'zzeta_super_secreto';
process.env.DB_PATH = process.env.DB_PATH || `zzeta.load.${Date.now()}.db`;
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1234567890';
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test_token';
process.env.WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v24.0';
process.env.BOT_MIN_LEAD_MINUTES = process.env.BOT_MIN_LEAD_MINUTES || '0';
process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'meta_app_secret_test';
process.env.WHATSAPP_SIGNATURE_REQUIRED = process.env.WHATSAPP_SIGNATURE_REQUIRED || 'true';

const app = require('../index');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function summarizeLatencies(latencies) {
  return {
    min: latencies.length ? Math.min(...latencies) : 0,
    max: latencies.length ? Math.max(...latencies) : 0,
    avg: latencies.length
      ? Number((latencies.reduce((acc, x) => acc + x, 0) / latencies.length).toFixed(2))
      : 0,
    p50: Number(percentile(latencies, 50).toFixed(2)),
    p95: Number(percentile(latencies, 95).toFixed(2)),
    p99: Number(percentile(latencies, 99).toFixed(2)),
  };
}

function computeSignature(rawBody) {
  return `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(rawBody)
    .digest('hex')}`;
}

function makePayload({ from, text, id, timestamp }) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from,
                  id,
                  timestamp,
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

function createFetchMock({ chaos }) {
  return async function fetchMock() {
    const r = Math.random();
    if (chaos && r < 0.07) {
      await sleep(900);
      const err = new Error('upstream timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    if (chaos && r < 0.16) {
      await sleep(120 + Math.floor(Math.random() * 380));
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { message: 'upstream intermittent 500' } }),
        json: async () => ({ error: { message: 'upstream intermittent 500' } }),
      };
    }
    if (chaos && r < 0.26) {
      await sleep(250 + Math.floor(Math.random() * 950));
    } else {
      await sleep(15 + Math.floor(Math.random() * 80));
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: `wamid.load.${Date.now()}` }] }),
      text: async () => '',
    };
  };
}

async function runScenario({
  name,
  chaos,
  phases,
  userPoolSize = 60,
}) {
  global.fetch = createFetchMock({ chaos });

  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  const users = Array.from({ length: userPoolSize }).map((_, i) => `59598557${String(100 + i)}`);
  const corpus = [
    'hola',
    'turno',
    'corte',
    'barba',
    'perfilado de cejas',
    '2099-12-31',
    'quiero el turno de las 4',
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
    'hay turno el miercoles a las 11?',
  ];

  const latencies = [];
  let total = 0;
  let failures = 0;
  let errors500 = 0;
  let tooManyRequests429 = 0;
  let retries = 0;
  let maxInFlight = 0;
  let inFlight = 0;
  let requestCounter = 0;
  const statusHistogram = {};
  const memorySamples = [];

  const cpuStart = process.cpuUsage();
  const hrStart = process.hrtime.bigint();
  const memTicker = setInterval(() => {
    const mem = process.memoryUsage();
    memorySamples.push({
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    });
  }, 200);

  async function sendOne(phaseName) {
    const from = users[Math.floor(Math.random() * users.length)];
    const text = corpus[Math.floor(Math.random() * corpus.length)];
    const payload = makePayload({
      from,
      text,
      id: `load-${phaseName}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const raw = JSON.stringify(payload);
    const signature = computeSignature(raw);

    const attemptsAllowed = 3;
    let attempt = 0;
    while (attempt < attemptsAllowed) {
      attempt += 1;
      const started = Date.now();
      inFlight += 1;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      requestCounter += 1;

      try {
        const res = await request(app)
          .post('/meta-webhook')
          .set('x-webhook-debug', '1')
          .set('x-forwarded-for', `10.66.${requestCounter % 250}.${(requestCounter * 7) % 250}`)
          .set('x-hub-signature-256', signature)
          .set('Content-Type', 'application/json')
          .send(raw);

        const latency = Date.now() - started;
        latencies.push(latency);
        total += 1;
        statusHistogram[res.statusCode] = (statusHistogram[res.statusCode] || 0) + 1;

        if (res.statusCode === 429) tooManyRequests429 += 1;
        if (res.statusCode >= 500) {
          failures += 1;
          errors500 += 1;
        } else if (res.body && res.body.ok === false) {
          failures += 1;
        }

        if (res.statusCode >= 500 && attempt < attemptsAllowed) {
          retries += 1;
          await sleep(80 * (2 ** (attempt - 1)));
          continue;
        }

        return;
      } catch (_err) {
        const latency = Date.now() - started;
        latencies.push(latency);
        total += 1;
        failures += 1;
        errors500 += 1;
        statusHistogram['exception'] = (statusHistogram['exception'] || 0) + 1;
        if (attempt < attemptsAllowed) {
          retries += 1;
          await sleep(80 * (2 ** (attempt - 1)));
          continue;
        }
        return;
      } finally {
        inFlight -= 1;
      }
    }
  }

  async function runPhase({ name: phaseName, requests, concurrency, pauseMinMs, pauseMaxMs }) {
    let cursor = 0;
    async function worker() {
      while (true) {
        if (cursor >= requests) return;
        cursor += 1;
        if (pauseMaxMs > 0) {
          const delta = pauseMinMs + Math.floor(Math.random() * (pauseMaxMs - pauseMinMs + 1));
          await sleep(delta);
        }
        await sendOne(phaseName);
      }
    }

    const workers = Array.from({ length: concurrency }).map(() => worker());
    await Promise.all(workers);
  }

  for (const phase of phases) {
    await runPhase(phase);
    if (phase.idleAfterMs) {
      await sleep(phase.idleAfterMs);
    }
  }

  clearInterval(memTicker);
  eventLoop.disable();

  const elapsedMs = Number(process.hrtime.bigint() - hrStart) / 1e6;
  const cpu = process.cpuUsage(cpuStart);
  const cpuPercent = Number((((cpu.user + cpu.system) / 1000 / elapsedMs) * 100).toFixed(2));

  const memStart = memorySamples[0] || { rss: 0, heapUsed: 0 };
  const memEnd = memorySamples[memorySamples.length - 1] || { rss: 0, heapUsed: 0 };
  const memMax = memorySamples.reduce(
    (acc, s) => ({
      rss: Math.max(acc.rss, s.rss || 0),
      heapUsed: Math.max(acc.heapUsed, s.heapUsed || 0),
      heapTotal: Math.max(acc.heapTotal, s.heapTotal || 0),
    }),
    { rss: 0, heapUsed: 0, heapTotal: 0 }
  );

  const summary = {
    name,
    chaos,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    throughputReqPerSec: Number(((total / elapsedMs) * 1000).toFixed(2)),
    totalRequests: total,
    failures,
    errorRatePercent: total ? Number(((failures / total) * 100).toFixed(2)) : 0,
    retries,
    retryRatioPercent: total ? Number(((retries / total) * 100).toFixed(2)) : 0,
    statusHistogram,
    http429: tooManyRequests429,
    http5xx: errors500,
    latencyMs: summarizeLatencies(latencies),
    maxInFlight,
    cpuPercent,
    memory: {
      start: memStart,
      end: memEnd,
      max: memMax,
      growthBytes: {
        rss: (memEnd.rss || 0) - (memStart.rss || 0),
        heapUsed: (memEnd.heapUsed || 0) - (memStart.heapUsed || 0),
      },
    },
    eventLoopDelayMs: {
      mean: Number((eventLoop.mean / 1e6).toFixed(2)),
      max: Number((eventLoop.max / 1e6).toFixed(2)),
      p99: Number((eventLoop.percentile(99) / 1e6).toFixed(2)),
    },
  };

  return summary;
}

function buildComparison(base, stress) {
  return {
    latencyP95DeltaMs: Number((stress.latencyMs.p95 - base.latencyMs.p95).toFixed(2)),
    latencyP99DeltaMs: Number((stress.latencyMs.p99 - base.latencyMs.p99).toFixed(2)),
    errorRateDeltaPercent: Number((stress.errorRatePercent - base.errorRatePercent).toFixed(2)),
    retryRatioDeltaPercent: Number((stress.retryRatioPercent - base.retryRatioPercent).toFixed(2)),
    throughputDeltaReqPerSec: Number(
      (stress.throughputReqPerSec - base.throughputReqPerSec).toFixed(2)
    ),
    memoryGrowthDeltaBytes: {
      rss: stress.memory.growthBytes.rss - base.memory.growthBytes.rss,
      heapUsed: stress.memory.growthBytes.heapUsed - base.memory.growthBytes.heapUsed,
    },
  };
}

async function main() {
  const baseline = await runScenario({
    name: 'baseline',
    chaos: false,
    phases: [
      { name: 'warmup', requests: 80, concurrency: 8, pauseMinMs: 5, pauseMaxMs: 60, idleAfterMs: 250 },
      { name: 'steady', requests: 180, concurrency: 12, pauseMinMs: 0, pauseMaxMs: 45, idleAfterMs: 150 },
      { name: 'peak', requests: 120, concurrency: 18, pauseMinMs: 0, pauseMaxMs: 20 },
    ],
  });

  const stressChaos = await runScenario({
    name: 'stress-chaos',
    chaos: true,
    phases: [
      { name: 'warmup', requests: 100, concurrency: 10, pauseMinMs: 10, pauseMaxMs: 90, idleAfterMs: 300 },
      { name: 'burst-1', requests: 220, concurrency: 20, pauseMinMs: 0, pauseMaxMs: 30, idleAfterMs: 120 },
      { name: 'burst-2', requests: 220, concurrency: 28, pauseMinMs: 0, pauseMaxMs: 25, idleAfterMs: 120 },
      { name: 'spike', requests: 160, concurrency: 36, pauseMinMs: 0, pauseMaxMs: 20 },
    ],
  });

  const comparison = buildComparison(baseline, stressChaos);
  const report = {
    generatedAt: new Date().toISOString(),
    baseline,
    stressChaos,
    comparison,
  };

  const reportsDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, 'webhook-load-chaos.latest.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(reportsDir, 'webhook-load-chaos.latest.md');
  const md = [
    '# Webhook Load + Chaos Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Baseline',
    `- Total requests: ${baseline.totalRequests}`,
    `- Error rate: ${baseline.errorRatePercent}%`,
    `- Latency p95/p99: ${baseline.latencyMs.p95}ms / ${baseline.latencyMs.p99}ms`,
    `- Throughput: ${baseline.throughputReqPerSec} req/s`,
    '',
    '## Stress + Chaos',
    `- Total requests: ${stressChaos.totalRequests}`,
    `- Error rate: ${stressChaos.errorRatePercent}%`,
    `- Retry ratio: ${stressChaos.retryRatioPercent}%`,
    `- HTTP 429: ${stressChaos.http429}`,
    `- Latency p95/p99: ${stressChaos.latencyMs.p95}ms / ${stressChaos.latencyMs.p99}ms`,
    `- Throughput: ${stressChaos.throughputReqPerSec} req/s`,
    '',
    '## Delta (Stress - Baseline)',
    `- p95 delta: ${comparison.latencyP95DeltaMs}ms`,
    `- p99 delta: ${comparison.latencyP99DeltaMs}ms`,
    `- Error rate delta: ${comparison.errorRateDeltaPercent}%`,
    `- Retry ratio delta: ${comparison.retryRatioDeltaPercent}%`,
    `- Throughput delta: ${comparison.throughputDeltaReqPerSec} req/s`,
    '',
    `JSON report: ${jsonPath}`,
  ].join('\n');
  fs.writeFileSync(mdPath, md);

  console.log(`Report JSON: ${jsonPath}`);
  console.log(`Report MD: ${mdPath}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
