# Monitoring 30D Checklist (Webhook + Bot)

## Monitoreo minimo obligatorio
- `error_rate_webhook > 2%` en ventana de 5m: alerta amarilla.
- `error_rate_webhook > 5%` en ventana de 5m: alerta roja.
- `latency_p95_webhook > 1200ms` en ventana de 10m: alerta amarilla.
- `latency_p95_webhook > 2500ms` en ventana de 10m: alerta roja.
- `retry_ratio > 8%` en ventana de 15m: investigar proveedor externo o red.
- `memory_heap_used_growth > 25%` sostenido por 6h: posible leak.
- `http_429_rate > 1%` sostenido por 10m: revisar rate-limit / origen de trafico.
- `webhook_failed_accumulated >= 50` en 30m: disparar incidente.

## Alertas inteligentes por tendencia
- Alerta por tendencia de `latency_p95` creciente 3 ventanas consecutivas, aunque no supere umbral duro.
- Spike detector en ventana movil (5m): `x2` sobre baseline de 24h en `error_rate` o `retry_ratio`.
- Deteccion de drift conversacional: aumento de mensajes de fallback (`Puedo ayudarte...`) > `30%` sobre promedio semanal.
- Deteccion de degradacion silenciosa: subida de `duplicate_event` o `out_of_order_event` > `3x` baseline.

## Riesgos residuales a vigilar
- Corrupcion silenciosa de estado en sesiones muy largas.
- Deriva de intencion en conversaciones con multiples cambios de tema.
- Efecto cascada de retries cuando el proveedor externo responde intermitente.
- Saturacion gradual en picos sostenidos.
- Errores raros no reproducibles bajo fuzz aleatorio.

## Operacion diaria (5 minutos)
1. Revisar panel de latencia p50/p95/p99.
2. Revisar error-rate + histograma de estados HTTP.
3. Revisar retry-ratio y eventos de `duplicate_event`.
4. Verificar consumo de memoria y tendencia 24h.
5. Confirmar que `bot_enabled` no cambie sin trazabilidad.

## Operacion semanal
1. Ejecutar `npm run test:reliability`.
2. Ejecutar `npm run load:webhook` y comparar contra baseline anterior.
3. Actualizar tabla de riesgos con probabilidad x impacto.
