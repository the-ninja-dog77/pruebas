# Reliability Risk Matrix (Webhook WhatsApp)

## Cobertura por tipo de riesgo
- Tecnico/protocolo: payload incompleto, JSON invalido, firma invalida/expirada, dedupe por id, stale/out-of-order.
- Conversacional/estado: cambios de intencion, comandos fuera de contexto, expiracion de sesion, reactivacion.
- Lenguaje real: ambiguedad, ortografia severa, ruido, multilinea, injection-like text.
- Carga y caos: concurrencia, rafagas irregulares, retries, 500 intermitente, timeout externo, delay artificial.
- Integridad: idempotencia de confirmacion, consistencia temporal basica, ausencia de estados imposibles observables.

## Probabilidad x impacto
| Riesgo | Probabilidad | Impacto | Clasificacion |
|---|---:|---:|---|
| Duplicacion por retry de webhook | Media | Alta | Critico |
| Out-of-order de eventos | Media | Media | Controlado |
| Sesion inconsistente tras expiracion | Baja | Media | Controlado |
| Drift de intencion en sesiones largas | Media | Media | Aceptable |
| Saturacion por picos (latencia p99) | Media | Alta | Critico |
| Falla intermitente proveedor externo | Alta | Media | Controlado |
| Fuzz input inesperado | Media | Baja | Aceptable |
| Leak de memoria bajo carga sostenida | Baja | Alta | Tecnico diferido |

## Mapa de fallos recurrentes
- Mensajes ambiguos que mezclan reservar/cancelar/reprogramar en una sola frase.
- Retries del proveedor cuando hay latencia de salida alta.
- Sesiones largas con usuario contradictorio.

## Clasificacion de riesgos
- Criticos:
  - Duplicacion por retries sin idempotencia.
  - Degradacion fuerte de latencia en picos.
- Controlados:
  - Out-of-order events.
  - Expiracion parcial de sesion.
  - Fallas intermitentes del proveedor externo.
- Aceptables:
  - Ruido linguistico extremo.
  - Preguntas fuera de dominio cuando IA no esta activa.
- Tecnicos diferidos:
  - Telemetria profunda de thread blocking a nivel runtime.
  - Persistencia distribuida de dedupe para multi-instancia.

## Baseline vs stress
- Fuente de resultados: `reports/webhook-load-chaos.latest.json`.
- Comparar cada corrida semanal:
  - `latency p95/p99`
  - `error rate`
  - `retry ratio`
  - `throughput`
  - `growth heapUsed/rss`
