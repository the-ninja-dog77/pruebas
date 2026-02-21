# Webhook Load + Chaos Report

Generated: 2026-02-21T02:00:15.215Z

## Baseline
- Total requests: 380
- Error rate: 0%
- Latency p95/p99: 101ms / 112ms
- Throughput: 110.64 req/s

## Stress + Chaos
- Total requests: 819
- Error rate: 14.53%
- Retry ratio: 14.53%
- HTTP 429: 0
- Latency p95/p99: 915ms / 1117ms
- Throughput: 68.07 req/s

## Delta (Stress - Baseline)
- p95 delta: 814ms
- p99 delta: 1005ms
- Error rate delta: 14.53%
- Retry ratio delta: 14.53%
- Throughput delta: -42.57 req/s

JSON report: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\webhook-load-chaos.latest.json