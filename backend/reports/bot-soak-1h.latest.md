# Bot Soak Test (1h)

Generated: 2026-02-22T16:31:33.484Z
Configured duration: 01:00:00
Elapsed: 01:00:00
Adaptive profile enabled: yes

## Verdict
- Score: 89.39/100
- Grade: B
- Max pending: 46
- Phase coverage: 100%

## Total
- Sent: 23258
- OK: 21795
- Failures: 1463
- Failures (chaos/non-chaos): 1463/0
- Dropped (backpressure): 0
- Retries: 1463
- Error rate (attempt): 6.29%
- Error rate (event): 0%
- Error rate (event adjusted non-chaos): 0%
- Retry ratio: 6.29%
- Throughput: 6.46 req/s
- Latency p50/p95/p99: 112 / 1368 / 3820 ms
- Drop rate: 0%
- 5xx+exception: 6.29%
- Audio failure rate: 10.69%

## Strengths
- Error rate dentro de objetivo
- Resistencia al caos: 6.29% del error bruto proviene de fallas inyectadas controladas
- Backpressure controlado (dropped bajo)
- Cobertura de fases completa
- Idempotencia observada en eventos duplicados

## Weaknesses
- [medium] Latencia p95 elevada (latencyP95Ms: 1368 target=1200)
- [medium] Retry ratio alto (retryRatioPercent: 6.29 target=5)
- [medium] Pipeline de audio inestable (audioFailurePercent: 10.69 target=8)

## Recommendations
- [P1] Optimizar ruta /meta-webhook en carga [performance]
  why: p95 1368ms > 1200ms
  action: Perfilar parseo, IO de DB y pipeline STT; cachear lookups repetidos.
  verify: p95 <= 1200ms y p99 <= 3000ms.
- [P1] Reducir retries innecesarios [resilience]
  why: retry ratio 6.29% > 5%
  action: Revisar timeouts y errores recuperables/no recuperables en STT y media download.
  verify: retry ratio <= 5% sostenido.
- [P1] Fortalecer manejo de audio dificil [audio]
  why: audio failures 10.69% > 8%
  action: Ajustar retries/media timeout y forzar aclaracion temprana cuando confidence sea baja.
  verify: audio failure <= 8% en fase acero.

## Top Failure Signals
- status 200: 21795
- status 500: 1463
- reason duplicate_event: 3441
- reason out_of_order_event: 180
- audio reason audio_processed: 6013
- audio reason destructive_low_confidence: 2395
- audio reason audio_too_short: 999
- audio reason media_timeout: 657
- audio reason audio_noise_or_silence: 528
- audio reason media_not_found: 420
- audio reason media_auth_error: 389
- audio reason low_confidence: 382

## Trend
- Previous run: 2026-02-22T00:30:30.156Z
- Score delta: -2.96
- Error rate delta: 0
- p95 delta (ms): 515
- Drop rate delta: 0

## Phases
### Pruebas normales (normal)
- Sent: 261
- OK/Fail: 247/14
- Dropped: 0
- Text/Audio: 215/32
- Retries: 14
- Latency p50/p95/p99: 74/325/1113 ms

### Preguntas raras (raras)
- Sent: 295
- OK/Fail: 287/8
- Dropped: 0
- Text/Audio: 179/108
- Retries: 8
- Latency p50/p95/p99: 78/275/936 ms

### Mensajes desubicados (desubicados)
- Sent: 484
- OK/Fail: 461/23
- Dropped: 0
- Text/Audio: 245/216
- Retries: 23
- Latency p50/p95/p99: 91/708/3148 ms

### Prueba de acero (acero)
- Sent: 22218
- OK/Fail: 20800/1418
- Dropped: 0
- Text/Audio: 6374/14426
- Retries: 1418
- Latency p50/p95/p99: 114/1410/3841 ms

## Evolution Artifacts
- History: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.history.json
- Adaptive profile: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.adaptive-profile.json
- Next actions: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.next-actions.json
JSON report: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.latest.json