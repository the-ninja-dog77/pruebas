# Webhook Load + Chaos Report

Generated: 2026-02-21T02:47:35.467Z

## Baseline
- Total requests: 380
- Error rate: 0%
- Latency p95/p99: 98ms / 106ms
- Throughput: 114.08 req/s

## Stress + Chaos
- Total requests: 791
- Error rate: 11.5%
- Retry ratio: 11.5%
- HTTP 429: 0
- Latency p95/p99: 906ms / 1139ms
- Throughput: 72.68 req/s

## Delta (Stress - Baseline)
- p95 delta: 808ms
- p99 delta: 1033ms
- Error rate delta: 11.5%
- Retry ratio delta: 11.5%
- Throughput delta: -41.4 req/s

JSON report: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\webhook-load-chaos.latest.json