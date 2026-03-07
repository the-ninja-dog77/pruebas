const db = require('../database');
const logger = require('../logger');

let envUsersRawCache = null;
let envUsersMapCache = new Map();

function parseEnvUsers() {
  const raw = String(process.env.PANEL_USERS_JSON || '').trim();
  if (raw === envUsersRawCache) return envUsersMapCache;

  envUsersRawCache = raw;
  envUsersMapCache = new Map();
  if (!raw) return envUsersMapCache;

  try {
    const parsed = JSON.parse(raw);
    const usersArray = Array.isArray(parsed) ? parsed : parsed?.users;
    if (!Array.isArray(usersArray)) {
      logger.warn('PANEL_USERS_JSON invalido: se esperaba array o { users: [] }');
      return envUsersMapCache;
    }

    usersArray.forEach((item, index) => {
      const username = String(item?.username || '').trim().toLowerCase();
      const passwordHash = String(item?.passwordHash || '').trim();
      const role = String(item?.role || '').trim().toLowerCase();
      const barberId = Number(item?.barber_id || item?.barberId || 0);

      if (!username || !passwordHash) return;
      if (!passwordHash.startsWith('$2')) return;
      if (!['admin', 'barber'].includes(role)) return;
      if (!Number.isInteger(barberId) || barberId <= 0) return;

      envUsersMapCache.set(username, {
        id: Number.isInteger(Number(item?.id)) ? Number(item.id) : -(index + 1),
        username,
        passwordHash,
        role,
        barber_id: barberId,
      });
    });

    logger.info(`PANEL users loaded from env: ${envUsersMapCache.size}`);
  } catch (err) {
    logger.warn(`PANEL_USERS_JSON invalido: ${err.message}`);
  }

  return envUsersMapCache;
}

function findByUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return null;

  const envUsers = parseEnvUsers();
  if (envUsers.has(normalized)) {
    return envUsers.get(normalized);
  }

  return db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
    .get(normalized);
}

function findById(id) {
  const normalized = Number(id);
  if (!Number.isInteger(normalized)) return null;
  if (normalized <= 0) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(normalized);
}

function updatePasswordHash({ id, passwordHash }) {
  const normalizedId = Number(id);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) return { changes: 0 };
  return db
    .prepare('UPDATE users SET passwordHash = ? WHERE id = ?')
    .run(String(passwordHash || ''), normalizedId);
}

module.exports = {
  findByUsername,
  findById,
  updatePasswordHash,
};
