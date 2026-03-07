#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const args = { from: '', to: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--from') args.from = String(argv[i + 1] || '').trim();
    if (token === '--to') args.to = String(argv[i + 1] || '').trim();
    if (token === '--dry-run') args.dryRun = true;
  }
  return args;
}

function resolveDbPath(configuredPath) {
  const configured =
    configuredPath ||
    process.env.DB_PATH ||
    (process.env.NODE_ENV === 'production' ? '/app/data/zzeta.db' : 'zzeta.db');

  if (path.isAbsolute(configured)) return configured;
  if (process.env.NODE_ENV === 'production') {
    const persistentBase = process.env.PERSISTENT_DATA_DIR || '/app/data';
    return path.join(persistentBase, configured);
  }
  return path.join(process.cwd(), configured);
}

function resolveInputPath(inputPath) {
  if (!inputPath) return '';
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.join(process.cwd(), inputPath);
}

function validateSqlite(filePath) {
  const db = new Database(filePath, { readonly: true });
  try {
    db.prepare('SELECT 1').get();
  } finally {
    db.close();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = resolveInputPath(args.from);
  const target = resolveDbPath(args.to);

  if (!source) {
    console.error('Uso: node scripts/restoreBackup.js --from <backup.db> [--to <dbPath>] [--dry-run]');
    process.exit(1);
  }

  if (!fs.existsSync(source)) {
    console.error(`Backup no encontrado: ${source}`);
    process.exit(1);
  }

  validateSqlite(source);
  console.log(`Backup valido: ${source}`);

  if (args.dryRun) {
    console.log('Dry run OK: no se aplicaron cambios.');
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (fs.existsSync(target)) {
    const backupTarget = `${target}.pre-restore-${Date.now()}.bak`;
    fs.copyFileSync(target, backupTarget);
    console.log(`Copia preventiva creada: ${backupTarget}`);
  }

  fs.copyFileSync(source, target);
  validateSqlite(target);
  console.log(`Restore aplicado correctamente en: ${target}`);
}

main();
