# Audio Reliability Risk Matrix

## Cobertura implementada
- Pipeline completo: `audio -> STT/debug transcript -> evaluacion de confianza -> intencion/riesgo -> estado -> accion`.
- Edge de audio crudo: corto, largo, ruido/silencio, codec no soportado, clipping.
- Estado intermedio: correcciones, cancelaciones tardias, audio duplicado, stale/out-of-order.
- Ambigüedad: frases mixtas, cambios de intencion, contradicciones.
- Carga y caos: concurrencia audio, delays, errores intermitentes, retries.
- Fuzzing de payload audio mutado.
- Integridad: idempotencia por `message.id` y guardas de estado.

## Probabilidad x impacto (audio)
| Riesgo | Probabilidad | Impacto | Clasificacion |
|---|---:|---:|---|
| STT baja confianza con accion sensible | Media | Alta | Critico |
| Saturacion de cola de audio | Media | Alta | Critico |
| Timeout de STT intermitente | Alta | Media | Controlado |
| Ambiguedad semantica con ruido | Alta | Media | Controlado |
| Out-of-order de audios | Baja | Media | Controlado |
| Fatiga por demasiadas aclaraciones | Media | Media | Aceptable |
| Dedupe no distribuido multi-instancia | Baja | Alta | Tecnico diferido |

## Clasificacion de fallos
- Falla de audio: formato no soportado, duracion invalida, ruido/silencio.
- Falla de STT: timeout, red, transcript vacio, proveedor no disponible.
- Falla de intencion: confianza insuficiente para accion.
- Falla de estado: accion sensible bloqueada por confianza baja.
- Falla de timing: cola llena, cola con timeout, evento stale/out-of-order.

## Baseline vs stress audio
- Ver: `reports/audio-load-chaos.latest.json`.
- Indicadores clave:
  - `latency p50/p95/p99`
  - `error rate`
  - `retry ratio`
  - `audio.lowConfidencePct`
  - `audio.clarificationPct`
  - `audio.queue.*`
