# Go-Live P0 Checklist (Meta/Gupshup/Railway)

## 1) Salir de Sandbox Gupshup (obligatorio)
- No usar `proxy <botname>` para produccion.
- En Gupshup:
  - `Begin Go Live` en la app correcta.
  - Cargar numero real de WhatsApp Business API.
  - Configurar webhook productivo:
    - `https://<tu-app>.up.railway.app/gupshup-webhook`
  - Validar que el webhook quede `Active`.
- Prueba final:
  - Enviar `hola` al numero real.
  - Debe responder solo ZZETA Bot (sin mensajes de Proxy/Anagram).

## 2) Variables de entorno minimas (Railway)
- `WHATSAPP_PROVIDER=gupshup`
- `GUPSHUP_API_KEY=<api_key_live>`
- `GUPSHUP_SOURCE=<numero_emisor_sin_+>`
- `GUPSHUP_APP_NAME=<nombre_app_live>`
- `DB_PATH=/data/zzeta.db`
- `META_APP_SECRET=<app_secret_meta>`
- `WHATSAPP_SIGNATURE_REQUIRED=true`

## 3) Alertas automáticas (P0)
Variables nuevas:
- `OPS_ALERT_ERROR_RATE_PCT=5`
- `OPS_ALERT_P95_MS=1200`
- `OPS_ALERT_RSS_MB=450`
- `OPS_ALERT_OUTBOUND_FAIL_COUNT=10`
- `OPS_ALERT_WEBHOOK_FAIL_COUNT=25`
- `OPS_ALERT_PROVIDER_DOWN_FAIL_COUNT=8`
- `OPS_ALERT_PROVIDER_DOWN_FAIL_RATE_PCT=95`
- `OPS_ALERT_CHECK_INTERVAL_MS=60000`
- `OPS_ALERT_COOLDOWN_MS=600000`
- Opcional:
  - `OPS_ALERT_WEBHOOK_URL=<slack/discord/webhook propio>`
  - `OPS_ALERT_WEBHOOK_TOKEN=<token>`

Verificacion:
- `GET /metrics` debe incluir `ops` y `alerts`.
- `GET /metrics/alerts` (admin) para diagnostico interno.

## 4) Audio robusto (P0)
Variables recomendadas:
- `AUDIO_MEDIA_METADATA_RETRIES=2`
- `AUDIO_MEDIA_DOWNLOAD_RETRIES=2`
- `AUDIO_STT_RETRIES=2`
- `AUDIO_RETRY_BACKOFF_MS=350`
- `AUDIO_MEDIA_TIMEOUT_MS=15000`
- `AUDIO_STT_TIMEOUT_MS=15000`
- `AUDIO_TRANSIENT_FAILURE_ESCALATE_AFTER=2`
- `AUDIO_TRANSIENT_FAILURE_TTL_MS=600000`

Resultado esperado:
- Si falla audio 1 vez: pide reenviar.
- Si falla repetido: sugiere pasar a texto en un solo mensaje para no frenar.

## 5) Seguridad panel (P0)
Configurar usuarios por variable con hash bcrypt:
- `PANEL_USERS_JSON=[{"username":"gonzabarber","passwordHash":"$2b$12$...","role":"barber","barber_id":1}]`

Endurecimiento recomendado:
- `SEED_LEGACY_DEFAULT_USERS=false`
- `AUTH_BLOCK_LEGACY_DEFAULTS=true`
- `JWT_SECRET_CURRENT=<secreto_nuevo_largo>`
- `JWT_SECRET_PREVIOUS=<secreto_anterior>`
- opcional: `AUTH_ENFORCE_MIN_BCRYPT_COST=true` y `AUTH_MIN_BCRYPT_COST=12`

Generar hash:
- `npm run security:hash -- "tu_password_fuerte"`

Recomendacion:
- Rotar `JWT_SECRET_CURRENT/JWT_SECRET_PREVIOUS` y `PANEL_USERS_JSON` cada 60-90 dias.
- Permitir cambio de password autenticado via `POST /auth/rotate-password`.
