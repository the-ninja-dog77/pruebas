# MEMORIA OPERATIVA ZZETA

Ultima actualizacion: 2026-02-21

## 1) Objetivo del proyecto
- Tener un sistema real de barberia con:
- Backend (API + bot WhatsApp + base de datos)
- Web app movil para barbero (resumen, calendario, control del bot)
- Flujo estable para reservar/cancelar/reprogramar
- Despliegue 24/7 en Railway

## 2) Enfoque de trabajo acordado
- Prioridad: funcionamiento real en produccion antes que features bonitas.
- Cada cambio importante debe:
- probarse localmente
- subirse con commit claro
- desplegarse y validarse en Railway
- No guardar secretos en Git (tokens/API keys nunca en commits).
- Usar esta memoria como fuente de contexto para reiniciar chats sin perder continuidad.

## 3) Estado funcional actual (resumen ejecutivo)
- Bot WhatsApp:
- Reserva de turnos por conversacion guiada.
- Detecta fecha/hora con lenguaje natural (ej. "martes que viene", "a las 4").
- Pide nombre + metodo de pago antes de confirmar.
- Puede cancelar y reprogramar.
- Restriccion: 1 turno activo por numero (salvo que se indique "a nombre de otra persona").
- Web app barbero:
- Login + panel movil.
- Vista resumen.
- Vista calendario mensual con horarios.
- Alta manual de turnos desde horario disponible (con servicio y precio).
- Toggle para prender/apagar bot.
- Backend:
- Arquitectura por capas (`routes/`, `controllers/`, `services/`, `repositories/`).
- SQLite (`better-sqlite3`) con migraciones/seeders.
- Health/metrics.
- Seguridad (JWT, rate limit, helmet, logs).

## 4) Infra y despliegue
- Plataforma: Railway.
- Base de datos: SQLite en volumen persistente.
- Webhook Meta: `/meta-webhook`.
- Estado esperado en Railway:
- `DB_PATH=zzeta.db` (o ruta valida dentro del volumen)
- Variables WhatsApp/Meta cargadas
- Servicio con dominio publico activo

## 5) Problemas abiertos (pendientes)
- Audio WhatsApp:
- Caso reportado: algunos audios responden "formato no soportado" o no avanzan flujo.
- Se hicieron mejoras para MIME raros, pero hay que validar en produccion con audios reales.
- Pruebas largas:
- El suite de tests de audio/reliability puede tardar mucho o colgar por handles abiertos.
- Necesita afinarse estrategia de test rapido vs test completo.

## 6) Commits recientes relevantes
- `0ba624c` Fix audio MIME parsing for WhatsApp codec params
- `d7ce0e8` Add audio reliability pipeline, stress suite, and monitoring artifacts
- `1b51868` Add production-grade webhook reliability matrix and load/chaos tooling
- `70b96e3` Add webhook reliability stress and context test matrix
- `7b444bf` Improve WhatsApp time parsing for natural 12h inputs
- `547257e` Fix WhatsApp stuck states and same-day reference handling
- `2192c67` Improve conversational intents for thanks, reschedule, and single-active booking
- `45010e9` Enforce one active booking per number and handle thanks naturally
- `4a3b590` Handle natural cancel messages by removing next upcoming booking
- `5245291` Add WhatsApp cancel/reschedule by customer name and date
- `b2536c9` Add customer name and payment method to bot booking flow
- `881755a` Add bot lead-time window to avoid unstable last-minute slots

## 7) Regla de continuidad (para nuevo chat)
Pegar este texto al iniciar:

`Lee MEMORIA_OPERATIVA_ZZETA.md y continuemos desde el estado actual. Quiero mantener el enfoque y la bitacora al dia.`

## 8) Bitacora de sesiones (agregar al final en cada avance)
Formato sugerido:

- Fecha:
- Objetivo:
- Cambios realizados:
- Archivos tocados:
- Resultado:
- Pendiente siguiente:
- Commit(s):

### Sesion 2026-02-21 (test integral bot)
- Fecha: 2026-02-21
- Objetivo: Testear localmente todas las funciones del bot y corregir fallos encontrados.
- Cambios realizados:
- Se ejecuto `npx jest tests/metaWebhookConversation.test.js --runInBand --detectOpenHandles --forceExit`.
- Se detecto fallo critico: `TypeError: app.address is not a function` por `backend/index.js` en modo standalone (sin export correcto para Supertest).
- Se restauro `backend/index.js` al bootstrap real del backend (arquitectura por capas, `module.exports = app`, sin `listen` en `NODE_ENV=test`).
- Se ejecuto suite extendida: `npm run test:reliability` (conversation + reliability + matrix + audio).
- Se ejecuto suite completa: `npm test -- --runInBand`.
- Se ejecutaron pruebas de carga/caos: `npm run load:webhook` y `npm run load:audio`.
- Archivos tocados:
- `backend/index.js` (correccion para entorno de test/local)
- `MEMORIA_OPERATIVA_ZZETA.md` (registro de esta sesion)
- Resultado:
- Tests funcionales del bot: OK.
- Tests de fiabilidad/audio: OK.
- Tests backend totales: 50/50 OK.
- Scripts de carga/caos: ejecutados correctamente (con errores 500 esperados en escenario chaos).
- Pendiente siguiente:
- Validar en Railway con mensajes reales de audio desde WhatsApp (especialmente MIME ambiguos).
- Confirmar si se desea commitear cambios pendientes de `audioPipeline` y reportes.
- Commit(s): Pendiente (no realizado en esta sesion).

## 9) Seguridad operativa (importante)
- Nunca copiar tokens reales en chats ni commits.
- Si un token se expone, rotarlo inmediatamente.
- Guardar secretos solo en variables de entorno (Railway / `.env` local fuera de Git).
