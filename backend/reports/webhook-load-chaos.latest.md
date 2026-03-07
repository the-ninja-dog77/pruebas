# Webhook Load + Chaos Report

Generated: 2026-03-02T04:19:44.856Z

## Baseline
- Total requests: 380
- Error rate: 0%
- Latency p95/p99: 99ms / 112ms
- Throughput: 113.42 req/s

## Stress + Chaos
- Total requests: 710
- Error rate: 1.41%
- Retry ratio: 1.41%
- HTTP 429: 0
- Latency p95/p99: 1316ms / 1715ms
- Throughput: 45.16 req/s

## Delta (Stress - Baseline)
- p95 delta: 1217ms
- p99 delta: 1603ms
- Error rate delta: 1.41%
- Retry ratio delta: 1.41%
- Throughput delta: -68.26 req/s

JSON report: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\webhook-load-chaos.latest.json