const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || 'zzeta.db';
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = 10; // mantener ultimos 10

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
  }
}

function rotateBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .sort()
    .reverse();

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);

    toDelete.forEach(file => {
      fs.unlinkSync(path.join(BACKUP_DIR, file));
      console.log(`Backup eliminado: ${file}`);
    });
  }
}

function createBackup() {
  ensureBackupDir();

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const backupFile = path.join(
    BACKUP_DIR,
    `backup-${timestamp}.db`
  );

  fs.copyFileSync(DB_PATH, backupFile);

  console.log(`Backup creado: ${backupFile}`);

  rotateBackups();
}

module.exports = {
  createBackup,
};
