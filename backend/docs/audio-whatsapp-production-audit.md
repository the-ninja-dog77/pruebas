# Auditoria de Audio WhatsApp para Produccion
Fecha: 2026-02-21  
Autor: auditoria tecnica (audio/STT/WhatsApp, enfoque bug-hunter)

## Alcance
- Canal WhatsApp Cloud API de audio.
- Pipeline completo: webhook -> media download -> STT -> intencion -> estado -> accion.
- Confiabilidad, resiliencia y riesgos silenciosos en produccion.

## Fase 1: Canal WhatsApp (audio real)

### 1.1 Tipos de audio y formatos soportados
Segun documentacion oficial de WhatsApp Cloud API/SDK:
- Mensajes de audio permitidos: `.aac`, `.amr`, `.mp3`, `.mp4`, `.ogg`.
- Restriccion critica: `.ogg` solo codec `OPUS`.
- Tamaño maximo de archivo de audio: `16 MB`.

Implicacion operativa:
- El webhook puede traer `mime_type` con variantes (`audio/ogg; codecs=opus`, `audio/mp4`, `application/octet-stream` en algunos clientes/reenvios).
- El pipeline debe ser tolerante en parseo de MIME sin abrir la puerta a tipos no-audio.

### 1.2 Grabado vs reenviado (realidad de campo)
Inferencia operativa basada en comportamiento real de clientes:
- Nota de voz grabada en app suele llegar como `audio/ogg` (opus) o variantes equivalentes.
- Audio de galeria/archivo puede llegar como `audio/mp4`/`audio/mpeg`/`audio/aac`.
- Reenvios multiples pueden cambiar compresion, volumen y calidad.
- La metadata no siempre trae toda la info acustica util (ruido, clipping, silencio real).

### 1.3 Descarga del audio (flujo oficial)
Flujo Cloud API:
1. Webhook entrega `messages[].audio.id` (media ID).
2. Se consulta `GET /{MEDIA_ID}` para obtener `url` temporal.
3. Se descarga esa URL con Bearer token.

Puntos oficiales clave:
- La URL de media expira rapido (validez aproximada de 5 minutos).
- Descargar siempre con Access Token valido.
- Error 404 en descarga puede significar URL expirada/no disponible.

### 1.4 Problemas reales esperables en produccion
- URL expirada (latencia/reintentos tardios).
- Token invalido/expirado (401/403).
- Payload incompleto (falta `audio.id`).
- MIME inconsistente (cliente, version, reenvio).
- Audio dificil para STT: ruido, silencios largos, recortes, volumen bajo, clipping.
- Llegadas fuera de orden o duplicadas.

## Fase 2: Pipeline de procesamiento (diseno robusto)

## Pipeline recomendado
`Audio inbound -> Validacion payload -> Validacion MIME/tamano/duracion -> Descarga media -> STT -> Evaluacion confianza/riesgo -> Decision de estado -> Accion o aclaracion`

### 2.1 Paso a paso con fallos, deteccion y fallback

1) Inbound webhook
- Puede fallar: firma invalida, evento duplicado, stale, out-of-order.
- Detectar: validacion HMAC, dedupe por `message.id`, ventana temporal.
- Log obligatorio: `from`, `messageId`, `eventTs`, `reason`.
- Fallback: `200` controlado con `reason` en debug para no reintentar infinito.
- Nunca hacer: ejecutar accion antes de dedupe/orden temporal.

2) Validacion de payload audio
- Puede fallar: falta `audio.id`, MIME no-audio, tamaño fuera de limite, duracion invalida.
- Detectar: validaciones tempranas.
- Log: `mime`, `file_size`, `duration`, `reason`.
- Fallback: respuesta clara y pedir reenvio/texto.
- Nunca hacer: pasar audio invalido a STT.

3) Descarga de media (metadata + archivo)
- Puede fallar: 401/403 auth, 404 URL expirada, 429/5xx transitorios, timeout.
- Detectar: clasificacion por status HTTP.
- Log: etapa (`metadata`/`download`), status, retries.
- Fallback:
- `media_auth_error`: pedir reenvio y revisar credenciales.
- `media_url_expired_or_not_found`: pedir reenviar audio.
- `media_timeout`: reintento y luego fallback textual.
- Nunca hacer: ocultar todos los errores como uno solo.

4) STT
- Puede fallar: key faltante, provider auth error, 5xx temporal, timeout, transcript vacio.
- Detectar: clasificacion de errores + retries con backoff.
- Log: provider, modelo, retries, status.
- Fallback:
- `stt_not_configured` o `stt_auth_error`: degradar a texto explicitamente.
- `stt_provider_error`/`stt_timeout_or_network`: pedir reenvio.
- Nunca hacer: inferir intencion sin transcript util.

5) NLU/Intencion + Riesgo
- Puede fallar: baja confianza, ambiguedad, contradiccion.
- Detectar: umbrales por tipo de accion (informativa vs sensible).
- Log: `confidence`, `risk`, `decision`.
- Fallback: pedir aclaracion o confirmacion en texto para acciones sensibles.
- Nunca hacer: ejecutar cancelaciones/reprogramaciones con confianza debil.

6) Estado conversacional/accion
- Puede fallar: flujo colgado, estado imposible, doble ejecucion.
- Detectar: validacion de stage, idempotencia de eventos, transiciones validas.
- Log: stage previo/posterior y accion aplicada.
- Fallback: reset controlado de flujo.
- Nunca hacer: transiciones implicitas sin validar contexto.

## Fase 3: Casos para romper el sistema (destructive mindset)

### 3.1 Edge tecnicos
- Audio con `mime_type` vacio.
- `audio.id` ausente.
- `application/octet-stream`.
- `application/pdf` marcado como audio.
- Media metadata 401, 403, 404, 429, 500.
- Download 404 por URL expirada.
- STT 401/403/429/500.
- Timeout de metadata/download/STT.

### 3.2 Casos humanos reales
- "mañana... no, perdon, el viernes" en un solo audio.
- 5 audios seguidos corrigiendo fecha/hora.
- audio con "si, no, mejor no, si".
- lenguaje ambiguo ("pone lo de siempre", "eso del otro dia").
- voz enojada o acelerada con baja inteligibilidad.

### 3.3 Casos de estado
- Audio de confirmar sin borrador completo.
- Audio de cancelar sin turno activo.
- Audio viejo llega despues de una reprogramacion.
- Audio duplicado con mismo `message.id`.

### 3.4 Estres
- 100+ audios concurrentes de usuarios distintos.
- mezcla de audios cortos + largos.
- picos irregulares tipo humano.
- degradacion parcial del proveedor STT.

## Fase 4: Busqueda sistematica de bugs

### Criticos
1) Ejecucion de accion sensible con baja confianza.
- Danio: cancelacion/reprogramacion incorrecta.
- Prevencion: umbral mas alto + confirmacion obligatoria en texto.
- Test: audio "cancelar turno" con confianza < umbral.

2) Doble ejecucion por duplicado webhook.
- Danio: doble reserva/cancelacion.
- Prevencion: dedupe por `message.id` + idempotencia en capa de negocio.
- Test: mismo payload enviado dos veces.

### Graves
3) Cola de audio vencida que igual ejecuta tarea.
- Danio: consumo de recursos y respuestas tardias fuera de contexto.
- Prevencion: cancelacion real de item en cola al timeout.
- Test: timeout forzado con tarea lenta.

4) Errores de media clasificados genericamente.
- Danio: debugging ciego y respuesta incorrecta al usuario.
- Prevencion: reasons especificos (`media_auth_error`, `media_url_expired_or_not_found`, etc.).
- Test: inyectar 401/404/429 por etapa.

### Medios
5) MIME ambiguo rechazado indebidamente.
- Danio: mala UX, audios validos descartados.
- Prevencion: aceptar `audio/*` + algunos ambiguos conocidos.
- Test: `audio/aac`, `application/octet-stream`.

6) MIME no-audio aceptado por error.
- Danio: pipeline procesa basura.
- Prevencion: rechazar todo no-audio excepto ambiguedades explicitas permitidas.
- Test: `application/pdf`, `video/mp4`.

### Silenciosos
7) `GROQ_BASE_URL` mal configurado (URL de consola).
- Danio: STT caido sin causa clara.
- Prevencion: normalizar/fallback automatico a URL oficial.
- Test: env invalido + assert URL final usada.

8) Reintentos STT reutilizando body consumido.
- Danio: retry inutil o fallos espurios.
- Prevencion: recrear `FormData` por intento.
- Test: primer intento 500, segundo 200.

## Fase 5: Pruebas automatizadas y de carga

### Cobertura implementada
- `tests/metaWebhookAudioReliability.test.js`
- pipeline de audio, fuzzing, edge de formato, confianza, idempotencia, sesiones largas.
- `tests/audioStt.service.test.js` (agregado en esta auditoria)
- fallback de base URL, errores 401/404 media/STT, retries STT, uso de `phone_number_id`.

### Carga y caos ejecutados
- `npm run load:webhook`
- `npm run load:audio`
- Metricas observadas:
- `p50/p95/p99` de latencia
- `errorRatePercent`
- `retryRatioPercent`
- `throughputReqPerSec`
- `audio.failureByType`, `audio.reasonCounts`, `audio.queue.*`

Objetivo operativo:
- Acciones mal ejecutadas: `0`.
- Acciones sensibles con baja confianza: siempre bloqueadas o confirmadas.

## Fase 6: Endurecimiento final aplicado

Cambios de codigo aplicados:
- Clasificacion de errores media/STT mas granular.
- Reintentos con backoff en metadata/download/STT.
- `FormData` recreado por intento STT.
- Validacion/fallback defensivo de `GROQ_BASE_URL`.
- Soporte de `phone_number_id` al resolver media.
- Timeout de cola de audio con cancelacion segura.
- Mapeo de fallbacks de usuario por reason.
- Tests unitarios nuevos de hardening STT.

## Recomendaciones finales de produccion (3 AM / 10k usuarios)
- Mantener `AUDIO_STT_CONCURRENCY` y cola con limites estrictos.
- Alertar por tendencia (no solo umbral) en:
- `audio_queue_timeout`
- `media_auth_error`
- `stt_auth_error`
- `lowConfidencePct`
- Registrar correlation-id por mensaje para trazabilidad cross-stage.
- Definir circuito de degradacion:
- si STT inestable => modo texto guiado temporal.
- Ejecutar chaos tests semanales y comparar baseline.

## Fuentes oficiales y tecnicas
- WhatsApp Node.js SDK - Audio Messages (tipos de archivo soportados):  
  https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/audio/
- Meta/WhatsApp Postman - Media Object (tipos y limites de media):  
  https://www.postman.com/meta/whatsapp-business-platform/request/ya09e8d/media-object
- Meta/WhatsApp Postman - Retrieve Media URL (validez URL ~5 min y descarga con token):  
  https://www.postman.com/meta/whatsapp-business-platform/request/p2h0j01/retrieve-media-url
- Meta/WhatsApp Postman - Upload Media (lifecycle de media en Cloud API):  
  https://www.postman.com/meta/whatsapp-business-platform/request/p4u8f20/upload-media

Nota: algunas diferencias Android/iOS/Web se documentan aqui como inferencia operativa de campo; cuando Meta no explicita por cliente, se valida por telemetria y pruebas reales.
