# Audio Monitoring 30D Checklist

## Alertas minimas
- `% audios low-confidence > 15%` (ventana 15m): alerta amarilla.
- `% audios low-confidence > 25%` (ventana 15m): alerta roja.
- `% audios con aclaracion > 20%` (ventana 15m): alerta.
- `latencia audio->decision p95 > 1800ms` (10m): alerta.
- `latencia audio->decision p95 > 3000ms` (10m): critica.
- `retry ratio STT > 8%` (15m): revisar proveedor/audio quality.
- `audio queue timeout > 0` sostenido por 5m: critica.
- `audio queue rejected > 0` sostenido por 5m: critica.
- `out_of_order audio events > baseline*3` (1h): alerta.

## Señales de degradacion semantica
- Aumento sostenido de respuestas "No entendi..." > 30% del baseline semanal.
- Incremento de confirmaciones forzadas para acciones de riesgo.
- Subida de cancelaciones o reprogramaciones inmediatamente despues de una accion por audio.
- Deriva de contexto en conversaciones largas (señal: mas de 2 aclaraciones seguidas).

## Riesgos residuales
- STT con confianza media que "parece" correcta pero no lo es.
- Accion sensible disparada por audio ambiguo en ruido alto.
- Fatiga del usuario por exceso de aclaraciones.
- Perdida gradual de contexto sin crash explicito.

## Rutina diaria (5-10 min)
1. Revisar `audio.lowConfidencePct`, `audio.clarificationPct`.
2. Revisar `audio.latency p95/p99`.
3. Revisar `audio.failureByType` y `audio.reasonCounts`.
4. Revisar `audio.queue.peakDepth`, `audio.queue.timeout`, `audio.queue.rejected`.
5. Revisar outliers de `out_of_order_event` y `stale_event`.

## Rutina semanal
1. Correr `npm run test:audio`.
2. Correr `npm run load:audio`.
3. Comparar reportes `reports/audio-load-chaos.latest.*` contra semana anterior.
