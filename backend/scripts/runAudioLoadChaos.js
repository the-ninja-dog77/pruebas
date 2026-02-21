#!/usr/bin/env node
/* eslint-disable no-console */
const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('node:perf_hooks');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'zzeta_super_secreto';
process.env.DB_PATH = process.env.DB_PATH || `zzeta.audio-load.${Date.now()}.db`;
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1234567890';
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test_token';
process.env.WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v24.0';
process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'meta_app_secret_audio_load';
process.env.WHATSAPP_SIGNATURE_REQUIRED = process.env.WHATSAPP_SIGNATURE_REQUIRED || 'true';
process.env.AUDIO_STT_PROVIDER = process.env.AUDIO_STT_PROVIDER || 'none';

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

function summarize(latencies) {
  return {
    p50: Number(percentile(latencies, 50).toFixed(2)),
    p95: Number(percentile(latencies, 95).toFixed(2)),
    p99: Number(percentile(latencies, 99).toFixed(2)),
    avg: latencies.length
      ? Number((latencies.reduce((acc, x) => acc + x, 0) / latencies.length).toFixed(2))
      : 0,
  };
}

function sign(raw) {
  return `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(raw)
    .digest('hex')}`;
}

function audioPayload({ from, id, timestamp, transcript, confidence, duration, flags, mimeType }) {
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
                  type: 'audio',
                  audio: {
                    id: `media-${id}`,
                    mime_type: mimeType || 'audio/ogg',
                    file_size: Math.max(1024, Math.floor(duration * 8000)),
                    debug_transcript: transcript,
                    debug_confidence: confidence,
                    debug_duration_sec: duration,
                    debug_flags: flags || [],
                  },
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
  return async function fetchMock(url, opts) {
    if (String(url).includes('/messages')) {
      if (chaos) {
        const r = Math.random();
        if (r < 0.08) {
          await sleep(700);
          return {
            ok: false,
            status: 500,
            text: async () => '{"error":{"message":"intermittent send error"}}',
            json: async () => ({ error: { message: 'intermittent send error' } }),
          };
        }
        if (r < 0.2) {
          await sleep(300 + Math.floor(Math.random() * 700));
        } else {
          await sleep(20 + Math.floor(Math.random() * 80));
        }
      } else {
        await sleep(15 + Math.floor(Math.random() * 60));
      }

      const payload = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: `wamid.audio.load.${Date.now()}` }], echo: payload }),
        text: async () => '',
      };
    }

    return {
      ok: false,
      status: 500,
      text: async () => '{"error":{"message":"unexpected fetch"}}',
      json: async () => ({ error: { message: 'unexpected fetch' } }),
    };
  };
}

async function runScenario({ name, chaos, totalRequests, concurrency }) {
  global.fetch = createFetchMock({ chaos });

  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  const latencies = [];
  const users = Array.from({ length: 80 }).map((_, i) => `59598558${String(100 + i)}`);
  const transcripts = [
    'hola',
    'turno',
    'corte',
    'quiero turno para martes a las 4',
    'mañana no perdon el viernes',
    'cancelar turno',
    'reprogramar mi turno',
    'a nombre de juan perez',
    'gracias',
    'confirmar',
    'hay horarios el miercoles',
    'efectivo',
  ];
  const durations = [0.2, 0.8, 1.2, 2.5, 5, 8, 12, 45, 90, 220];
  const confidenceLevels = [0.3, 0.45, 0.6, 0.72, 0.82, 0.91];

  let sent = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let retries = 0;
  let failures = 0;
  const statusHistogram = {};

  const cpuStart = process.cpuUsage();
  const start = process.hrtime.bigint();

  async function sendOne(i) {
    const from = users[i % users.length];
    const transcript = transcripts[Math.floor(Math.random() * transcripts.length)];
    const duration = durations[Math.floor(Math.random() * durations.length)];
    const confidence = confidenceLevels[Math.floor(Math.random() * confidenceLevels.length)];
    const flags = [];
    if (duration < 0.3) flags.push('abrupt_cut');
    if (Math.random() < 0.06) flags.push('noise_only');
    if (Math.random() < 0.04) flags.push('silence');

    const payload = audioPayload({
      from,
      id: `audio-load-${name}-${i}-${Math.random().toString(16).slice(2, 10)}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      transcript,
      confidence,
      duration,
      flags,
      mimeType: Math.random() < 0.04 ? 'audio/flac' : 'audio/ogg',
    });

    const raw = JSON.stringify(payload);
    const sig = sign(raw);

    const attempts = 2;
    let attempt = 0;
    while (attempt < attempts) {
      attempt += 1;
      const started = Date.now();
      inFlight += 1;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      try {
        const res = await request(app)
          .post('/meta-webhook')
          .set('x-webhook-debug', '1')
          .set('x-hub-signature-256', sig)
          .set('x-forwarded-for', `10.88.${i % 250}.${attempt}`)
          .set('Content-Type', 'application/json')
          .send(raw);

        latencies.push(Date.now() - started);
        statusHistogram[res.statusCode] = (statusHistogram[res.statusCode] || 0) + 1;
        sent += 1;
        if (res.statusCode >= 500) {
          failures += 1;
          if (attempt < attempts) {
            retries += 1;
            await sleep(60);
            continue;
          }
        }
        return;
      } catch (_err) {
        latencies.push(Date.now() - started);
        failures += 1;
        sent += 1;
        statusHistogram.exception = (statusHistogram.exception || 0) + 1;
        if (attempt < attempts) {
          retries += 1;
          await sleep(60);
          continue;
        }
        return;
      } finally {
        inFlight -= 1;
      }
    }
  }

  let cursor = 0;
  async function worker() {
    while (true) {
      if (cursor >= totalRequests) return;
      const i = cursor;
      cursor += 1;
      await sleep(Math.floor(Math.random() * 50));
      await sendOne(i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }).map(() => worker()));

  const metricsRes = await request(app).get('/metrics');
  const audioMetrics = metricsRes.body?.audio || {};

  eventLoop.disable();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const cpu = process.cpuUsage(cpuStart);
  const cpuPercent = Number((((cpu.user + cpu.system) / 1000 / elapsedMs) * 100).toFixed(2));

  return {
    name,
    chaos,
    totalRequests: sent,
    failures,
    retries,
    retryRatioPercent: sent ? Number(((retries / sent) * 100).toFixed(2)) : 0,
    errorRatePercent: sent ? Number(((failures / sent) * 100).toFixed(2)) : 0,
    throughputReqPerSec: Number(((sent / elapsedMs) * 1000).toFixed(2)),
    latencyMs: summarize(latencies),
    statusHistogram,
    maxInFlight,
    cpuPercent,
    eventLoopDelayMs: {
      p99: Number((eventLoop.percentile(99) / 1e6).toFixed(2)),
      max: Number((eventLoop.max / 1e6).toFixed(2)),
    },
    audioMetrics,
  };
}

function comparison(base, stress) {
  return {
    p95DeltaMs: Number((stress.latencyMs.p95 - base.latencyMs.p95).toFixed(2)),
    p99DeltaMs: Number((stress.latencyMs.p99 - base.latencyMs.p99).toFixed(2)),
    errorRateDeltaPercent: Number((stress.errorRatePercent - base.errorRatePercent).toFixed(2)),
    retryDeltaPercent: Number((stress.retryRatioPercent - base.retryRatioPercent).toFixed(2)),
    throughputDeltaReqPerSec: Number(
      (stress.throughputReqPerSec - base.throughputReqPerSec).toFixed(2)
    ),
  };
}

async function main() {
  const baseline = await runScenario({
    name: 'audio-baseline',
    chaos: false,
    totalRequests: 420,
    concurrency: 16,
  });

  const stress = await runScenario({
    name: 'audio-stress-chaos',
    chaos: true,
    totalRequests: 780,
    concurrency: 28,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    baseline,
    stress,
    comparison: comparison(baseline, stress),
  };

  const reportsDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, 'audio-load-chaos.latest.json');
  const mdPath = path.join(reportsDir, 'audio-load-chaos.latest.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    '# Audio Load + Chaos Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Baseline',
    `- Requests: ${baseline.totalRequests}`,
    `- Error rate: ${baseline.errorRatePercent}%`,
    `- Retry ratio: ${baseline.retryRatioPercent}%`,
    `- Latency p95/p99: ${baseline.latencyMs.p95}ms / ${baseline.latencyMs.p99}ms`,
    '',
    '## Stress + Chaos',
    `- Requests: ${stress.totalRequests}`,
    `- Error rate: ${stress.errorRatePercent}%`,
    `- Retry ratio: ${stress.retryRatioPercent}%`,
    `- Latency p95/p99: ${stress.latencyMs.p95}ms / ${stress.latencyMs.p99}ms`,
    '',
    '## Delta',
    `- p95 delta: ${report.comparison.p95DeltaMs}ms`,
    `- p99 delta: ${report.comparison.p99DeltaMs}ms`,
    `- error rate delta: ${report.comparison.errorRateDeltaPercent}%`,
    `- retry delta: ${report.comparison.retryDeltaPercent}%`,
    `- throughput delta: ${report.comparison.throughputDeltaReqPerSec} req/s`,
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
