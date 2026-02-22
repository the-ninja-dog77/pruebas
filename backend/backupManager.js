const fs = require('fs');
const path = require('path');

const MAX_BACKUPS = 10; // mantener ultimos 10

function resolveDbPath() {
  const configured = process.env.DB_PATH || (process.env.NODE_ENV === 'production' ? '/app/data/zzeta.db' : 'zzeta.db');
  if (path.isAbsolute(configured)) return configured;

  if (process.env.NODE_ENV === 'production') {
    const persistentBase = process.env.PERSISTENT_DATA_DIR || '/app/data';
    return path.join(persistentBase, configured);
  }

  return path.join(__dirname, configured);
}

function resolveBackupDir() {
  if (process.env.BACKUP_DIR) {
    const configured = process.env.BACKUP_DIR;
    if (path.isAbsolute(configured)) return configured;
    if (process.env.NODE_ENV === 'production') {
      const persistentBase = process.env.PERSISTENT_DATA_DIR || '/app/data';
      return path.join(persistentBase, configured);
    }
    return path.join(__dirname, configured);
  }
  return path.join(path.dirname(resolveDbPath()), 'backups');
}

function ensureBackupDir(backupDir) {
  if (!backupDir) return;
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

function rotateBackups(backupDir) {
  const files = fs
    .readdirSync(backupDir)
    .filter(f => f.endsWith('.db'))
    .sort()
    .reverse();

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);

    toDelete.forEach(file => {
      fs.unlinkSync(path.join(backupDir, file));
      console.log(`Backup eliminado: ${file}`);
    });
  }
}

function createBackup() {
  const dbPath = resolveDbPath();
  const backupDir = resolveBackupDir();
  ensureBackupDir(backupDir);

  if (!fs.existsSync(dbPath)) {
    console.warn(`No se pudo crear backup: DB no existe en ${dbPath}`);
    return null;
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const backupFile = path.join(
    backupDir,
    `backup-${timestamp}.db`
  );

  fs.copyFileSync(dbPath, backupFile);

  console.log(`Backup creado: ${backupFile}`);

  rotateBackups(backupDir);
  return backupFile;
}

module.exports = {
  createBackup,
};
