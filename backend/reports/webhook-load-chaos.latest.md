# Webhook Load + Chaos Report

Generated: 2026-02-21T03:48:44.971Z

## Baseline
- Total requests: 380
- Error rate: 0%
- Latency p95/p99: 97ms / 109ms
- Throughput: 116.58 req/s

## Stress + Chaos
- Total requests: 812
- Error rate: 13.79%
- Retry ratio: 13.79%
- HTTP 429: 0
- Latency p95/p99: 906ms / 1108ms
- Throughput: 73.41 req/s

## Delta (Stress - Baseline)
- p95 delta: 809ms
- p99 delta: 999ms
- Error rate delta: 13.79%
- Retry ratio delta: 13.79%
- Throughput delta: -43.17 req/s

JSON report: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\webhook-load-chaos.latest.json