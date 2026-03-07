# Runbook Backup/Restore (Railway + SQLite)

## Objetivo
Restaurar rapidamente la base ante corrupcion o error operativo sin perder trazabilidad.

## Ubicaciones
- DB productiva recomendada: `/data/zzeta.db`
- Backups automaticos: `/data/backups/backup-*.db`

## 1) Validar backup (sin tocar produccion)
```bash
cd backend
npm run backup:restore -- --from /data/backups/backup-YYYY-MM-DDTHH-mm-ss-sssZ.db --dry-run
```

## 2) Restaurar backup
```bash
cd backend
npm run backup:restore -- --from /data/backups/backup-YYYY-MM-DDTHH-mm-ss-sssZ.db --to /data/zzeta.db
```

El script hace:
- validacion SQLite del backup origen,
- copia preventiva de la DB actual (`.pre-restore-<timestamp>.bak`),
- reemplazo de DB destino,
- validacion final de integridad basica.

## 3) Verificacion post-restore
- `GET /health` => `status: ok`
- `GET /metrics` => responde y sin errores 5xx
- Login panel barbero funciona
- Turnos visibles en calendario y resumen

## 4) Ensayo periodico recomendado
- Frecuencia: 1 vez por semana.
- Flujo:
  - dry-run de ultimo backup
  - restore en entorno de prueba
  - checklist funcional minima (login, turno, cancelacion, balance)

## 5) Restore drill automatizado (evidencia)
Ejecuta un ensayo real sobre archivo temporal (no toca la DB productiva):

```bash
cd backend
npm run backup:drill
```

Salida esperada:
- reporte JSON: `backend/reports/backup-restore-drill.latest.json`
- `status: "ok"` y validacion de tablas SQLite.

Opciones utiles:

```bash
cd backend
npm run backup:drill -- --from /data/backups/backup-YYYY-MM-DDTHH-mm-ss-sssZ.db
npm run backup:drill -- --backup-dir /data/backups --keep-temp
```
