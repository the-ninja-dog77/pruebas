# Audio Reliability Consolidated Report

Generated: 2026-02-21T02:15:17Z

## 1) Suite avanzada de fiabilidad audio (pipeline completo)
- Archivo: `tests/metaWebhookAudioReliability.test.js`
- Resultado: `8/8` tests en verde.
- Cobertura:
  - Edge de audio crudo (corto/largo/silencio/ruido/codec no soportado/clipping).
  - Casos humanos reales (correcciones dentro del audio, cambios de intencion).
  - Ambiguedad y contexto largo (30 turnos audio-only).
  - Duplicados/out-of-order/stale por `message.id`/timestamp.
  - Fuzzing audio mutado (240 casos).
  - Consistencia temporal de misma solicitud en contextos distintos.

Matriz detallada por caso (input, estado previo, esperado, real, latencia, fallback):
- `reports/audio-reliability-matrix.latest.json`

## 2) Carga y chaos de audio
Fuente:
- `reports/audio-load-chaos.latest.json`
- `reports/audio-load-chaos.latest.md`

### Baseline
- Requests: `420`
- Error rate: `0%`
- Retry ratio: `0%`
- Latencia: `p50 57ms`, `p95 84ms`, `p99 123ms`
- Throughput: `187.98 req/s`

### Stress + Chaos
- Requests: `853`
- Error rate: `8.56%` (inducido por caos controlado)
- Retry ratio: `8.56%`
- Latencia: `p50 75ms`, `p95 711ms`, `p99 970ms`
- Throughput: `125.83 req/s`

### Delta (stress - baseline)
- p95: `+627ms`
- p99: `+847ms`
- Error rate: `+8.56%`
- Retry ratio: `+8.56%`
- Throughput: `-62.15 req/s`

## 3) Métricas audio-aware observadas
- `lowConfidencePct`: ~`37-39%` en carga mixta sintética (esperable por fuzz/caos).
- `clarificationPct`: ~`37-39%`.
- `failureByType`: distribución dominante en `intent` y `audio` bajo ruido/control de confianza.
- Cola audio (`audio.queue`): sin rechazos ni timeouts en esta corrida.

## 4) Riesgo residual (audio)
- Crítico:
  - degradación de latencia p95/p99 con proveedor externo inestable.
  - decisiones sensibles con confianza media si no hay confirmación explícita.
- Controlado:
  - dedupe por `message.id`,
  - stale/out-of-order,
  - fallback seguro ante baja confianza.
- Diferido:
  - dedupe distribuido multi-instancia (hoy es in-memory por instancia).
