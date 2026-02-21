# Reliability Consolidated Report

Generated: 2026-02-21T02:00:15Z

## 1) Cobertura de pruebas (suite avanzada)
- `tests/metaWebhookProductionMatrix.test.js`: 6 bloques grandes.
- Cobertura dimension A (tecnica): payload incompleto, JSON invalido, null critico, firma invalida/expirada, dedupe por id, stale/out-of-order.
- Cobertura dimension B (estado): reprogramar/cancelar/reactivar, comando en estado invalido, expiracion parcial de sesion.
- Cobertura dimension C (lenguaje sucio): ambiguedad, mezcla de comandos, ruido, multilinea, injection-like.
- Cobertura dimension D (stress conversacional): 40 turnos consecutivos con deriva de intencion.
- Capa extra:
  - fuzz testing (300 payloads mutados),
  - consistencia temporal basica,
  - integridad logica observable + idempotencia de confirmacion.

Fuente de detalle por caso (input/estado/esperado/real/latencia/fallback):
- `reports/webhook-reliability-matrix.latest.json`

## 2) Baseline vs Stress + Chaos
Fuente:
- `reports/webhook-load-chaos.latest.json`

### Baseline
- Requests: `380`
- Error rate: `0%`
- Latencia: `p50 63ms`, `p95 101ms`, `p99 112ms`
- Throughput: `110.64 req/s`
- 429: `0`

### Stress + Chaos
- Requests: `819`
- Error rate: `14.53%` (forzado por caos de proveedor)
- Retry ratio: `14.53%`
- Latencia: `p50 69ms`, `p95 915ms`, `p99 1117ms`
- Throughput: `68.07 req/s`
- 429: `0`

### Delta (stress - baseline)
- p95: `+814ms`
- p99: `+1005ms`
- Error rate: `+14.53%`
- Retry ratio: `+14.53%`
- Throughput: `-42.57 req/s`

## 3) Clasificacion de riesgos
- Criticos:
  - dependencia de proveedor externo bajo fallas intermitentes (impacta p95/p99),
  - degradacion de throughput en picos con caos.
- Controlados:
  - duplicados por retry (idempotencia por `message.id`),
  - eventos stale/out-of-order,
  - expiracion parcial de sesion.
- Aceptables:
  - ruido linguistico severo y ambiguedad (sin caidas, con fallback).
- Tecnicos diferidos:
  - dedupe distribuido multi-instancia (hoy es in-memory por instancia).

## 4) Recomendacion operacional 30 dias
- Ejecutar diario:
  - `npm run test:reliability`
- Ejecutar semanal:
  - `npm run load:webhook`
- Monitoreo y alertas:
  - ver `docs/monitoring-30d-checklist.md`
