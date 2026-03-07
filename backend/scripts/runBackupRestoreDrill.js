#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const args = {
    from: '',
    backupDir: '',
    report: '',
    keepTemp: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--from') args.from = String(argv[i + 1] || '').trim();
    if (token === '--backup-dir') args.backupDir = String(argv[i + 1] || '').trim();
    if (token === '--report') args.report = String(argv[i + 1] || '').trim();
    if (token === '--keep-temp') args.keepTemp = true;
  }

  return args;
}

function resolveDbPath() {
  const configured =
    process.env.DB_PATH ||
    (process.env.NODE_ENV === 'production' ? '/app/data/zzeta.db' : 'zzeta.db');
  if (path.isAbsolute(configured)) return configured;
  if (process.env.NODE_ENV === 'production') {
    const persistentBase = process.env.PERSISTENT_DATA_DIR || '/app/data';
    return path.join(persistentBase, configured);
  }
  return path.join(process.cwd(), configured);
}

function resolveBackupDir(customDir) {
  const configured = String(customDir || process.env.BACKUP_DIR || '').trim();
  if (configured) {
    if (path.isAbsolute(configured)) return configured;
    if (process.env.NODE_ENV === 'production') {
      const persistentBase = process.env.PERSISTENT_DATA_DIR || '/app/data';
      return path.join(persistentBase, configured);
    }
    return path.join(process.cwd(), configured);
  }

  return path.join(path.dirname(resolveDbPath()), 'backups');
}

function resolveAbsolutePath(inputPath) {
  const normalized = String(inputPath || '').trim();
  if (!normalized) return '';
  if (path.isAbsolute(normalized)) return normalized;
  return path.join(process.cwd(), normalized);
}

function pickLatestBackup(backupDir) {
  if (!fs.existsSync(backupDir)) return '';
  const files = fs
    .readdirSync(backupDir)
    .filter(file => file.endsWith('.db'))
    .map(file => path.join(backupDir, file))
    .sort((a, b) => {
      const aMtime = fs.statSync(a).mtimeMs;
      const bMtime = fs.statSync(b).mtimeMs;
      return bMtime - aMtime;
    });

  return files[0] || '';
}

function validateSqlite(filePath) {
  const db = new Database(filePath, { readonly: true });
  try {
    db.prepare('SELECT 1').get();
    const row = db
      .prepare(
        "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .get();
    return {
      ok: true,
      tables: Number(row?.total || 0),
    };
  } finally {
    db.close();
  }
}

function buildReportPath(inputPath) {
  if (inputPath) return resolveAbsolutePath(inputPath);
  return path.join(process.cwd(), 'reports', 'backup-restore-drill.latest.json');
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReport(reportPath, payload) {
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
}

function main() {
  const startedAt = new Date();
  const args = parseArgs(process.argv.slice(2));
  const backupDir = resolveBackupDir(args.backupDir);
  const sourceBackup =
    resolveAbsolutePath(args.from) || pickLatestBackup(backupDir);
  const reportPath = buildReportPath(args.report);
  const tempTarget = path.join(os.tmpdir(), `zzeta-restore-drill-${Date.now()}.db`);

  const baseReport = {
    startedAt: startedAt.toISOString(),
    backupDir,
    sourceBackup,
    tempTarget,
    status: 'failed',
    notes: [],
  };

  try {
    if (!sourceBackup) {
      throw new Error(`No se encontro backup para validar en ${backupDir}`);
    }
    if (!fs.existsSync(sourceBackup)) {
      throw new Error(`Backup no encontrado: ${sourceBackup}`);
    }

    const sourceValidation = validateSqlite(sourceBackup);
    if (!sourceValidation.ok) {
      throw new Error('Backup invalido');
    }

    fs.copyFileSync(sourceBackup, tempTarget);
    const restoredValidation = validateSqlite(tempTarget);
    if (!restoredValidation.ok) {
      throw new Error('Restore drill invalido');
    }

    const backupStats = fs.statSync(sourceBackup);
    const doneAt = new Date();
    const payload = {
      ...baseReport,
      status: 'ok',
      finishedAt: doneAt.toISOString(),
      durationMs: doneAt.getTime() - startedAt.getTime(),
      source: {
        sizeBytes: backupStats.size,
        modifiedAt: backupStats.mtime.toISOString(),
      },
      validation: {
        sourceTables: sourceValidation.tables,
        restoredTables: restoredValidation.tables,
      },
      notes: ['Restore drill ejecutado sobre archivo temporal sin tocar DB productiva.'],
    };

    writeReport(reportPath, payload);
    console.log(`Restore drill OK. Reporte: ${reportPath}`);

    if (!args.keepTemp && fs.existsSync(tempTarget)) {
      fs.unlinkSync(tempTarget);
    }
  } catch (err) {
    const doneAt = new Date();
    const payload = {
      ...baseReport,
      finishedAt: doneAt.toISOString(),
      durationMs: doneAt.getTime() - startedAt.getTime(),
      error: err.message,
      notes: [`Fallo en restore drill: ${err.message}`],
    };
    writeReport(reportPath, payload);
    console.error(`Restore drill FAIL: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
