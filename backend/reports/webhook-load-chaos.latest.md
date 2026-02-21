# Webhook Load + Chaos Report

Generated: 2026-02-21T04:06:51.967Z

## Baseline
- Total requests: 380
- Error rate: 0%
- Latency p95/p99: 97ms / 109ms
- Throughput: 115.13 req/s

## Stress + Chaos
- Total requests: 823
- Error rate: 14.95%
- Retry ratio: 14.95%
- HTTP 429: 0
- Latency p95/p99: 907ms / 1117ms
- Throughput: 70.22 req/s

## Delta (Stress - Baseline)
- p95 delta: 810ms
- p99 delta: 1008ms
- Error rate delta: 14.95%
- Retry ratio delta: 14.95%
- Throughput delta: -44.91 req/s

JSON report: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\webhook-load-chaos.latest.json