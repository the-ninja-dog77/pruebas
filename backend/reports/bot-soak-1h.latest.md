# Bot Soak Test (1h)

Generated: 2026-02-22T00:30:30.156Z
Configured duration: 00:00:36
Elapsed: 00:00:37
Adaptive profile enabled: yes

## Verdict
- Score: 92.35/100
- Grade: A
- Max pending: 36
- Phase coverage: 25%

## Total
- Sent: 189
- OK: 178
- Failures: 11
- Failures (chaos/non-chaos): 11/0
- Dropped (backpressure): 0
- Retries: 11
- Error rate (attempt): 5.82%
- Error rate (event): 0%
- Error rate (event adjusted non-chaos): 0%
- Retry ratio: 5.82%
- Throughput: 4.98 req/s
- Latency p50/p95/p99: 102 / 853 / 3778 ms
- Drop rate: 0%
- 5xx+exception: 5.82%
- Audio failure rate: 10.34%

## Strengths
- Error rate dentro de objetivo
- Resistencia al caos: 5.82% del error bruto proviene de fallas inyectadas controladas
- Backpressure controlado (dropped bajo)
- Latencia p95 dentro de objetivo
- Idempotencia observada en eventos duplicados

## Weaknesses
- [medium] Retry ratio alto (retryRatioPercent: 5.82 target=5)
- [medium] Pipeline de audio inestable (audioFailurePercent: 10.34 target=8)
- [medium] Cobertura baja en una o mas fases (phaseCoveragePercent: 25 target=100)
  details: Fases con baja muestra: normal, raras, desubicados

## Recommendations
- [P1] Reducir retries innecesarios [resilience]
  why: retry ratio 5.82% > 5%
  action: Revisar timeouts y errores recuperables/no recuperables en STT y media download.
  verify: retry ratio <= 5% sostenido.
- [P1] Fortalecer manejo de audio dificil [audio]
  why: audio failures 10.34% > 8%
  action: Ajustar retries/media timeout y forzar aclaracion temprana cuando confidence sea baja.
  verify: audio failure <= 8% en fase acero.
- [P2] Subir volumen minimo por fase [testing]
  why: Cobertura de fases 25%
  action: Incrementar SOAK_DURATION_MS o SOAK_PHASE_SCALE para obtener al menos 50 eventos por fase.
  verify: Todas las fases con >= 50 eventos.

## Top Failure Signals
- status 200: 178
- status 500: 11
- reason duplicate_event: 29
- reason out_of_order_event: 1
- audio reason audio_processed: 43
- audio reason audio_too_short: 14
- audio reason destructive_low_confidence: 11
- audio reason actionable_low_confidence: 7
- audio reason audio_noise_or_silence: 4
- audio reason media_not_found: 4
- audio reason media_timeout: 3
- audio reason low_confidence: 3

## Trend
- Previous run: 2026-02-22T00:21:47.229Z
- Score delta: -5.38
- Error rate delta: 0
- p95 delta (ms): 48
- Drop rate delta: 0

## Phases
### Pruebas normales (normal)
- Sent: 5
- OK/Fail: 5/0
- Dropped: 0
- Text/Audio: 4/1
- Retries: 0
- Latency p50/p95/p99: 89/164/164 ms

### Preguntas raras (raras)
- Sent: 4
- OK/Fail: 4/0
- Dropped: 0
- Text/Audio: 3/1
- Retries: 0
- Latency p50/p95/p99: 63/166/166 ms

### Mensajes desubicados (desubicados)
- Sent: 5
- OK/Fail: 4/1
- Dropped: 0
- Text/Audio: 3/1
- Retries: 1
- Latency p50/p95/p99: 107/1578/1578 ms

### Prueba de acero (acero)
- Sent: 175
- OK/Fail: 165/10
- Dropped: 0
- Text/Audio: 52/113
- Retries: 10
- Latency p50/p95/p99: 104/853/3778 ms

## Evolution Artifacts
- History: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.history.json
- Adaptive profile: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.adaptive-profile.json
- Next actions: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.next-actions.json
JSON report: C:\Users\ACER\Desktop\proyecto bot definitivo1.0\backend\reports\bot-soak-1h.latest.json