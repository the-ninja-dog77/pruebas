const bcrypt = require('bcrypt');
const usersRepo = require('../repositories/users.repository');
const jwtSecrets = require('./jwtSecrets.service');

const AUTH_BCRYPT_ROUNDS = Math.max(10, Number(process.env.AUTH_BCRYPT_ROUNDS || 12));
const AUTH_MIN_BCRYPT_COST = Math.max(10, Number(process.env.AUTH_MIN_BCRYPT_COST || 12));
const AUTH_ENFORCE_MIN_BCRYPT_COST =
  String(process.env.AUTH_ENFORCE_MIN_BCRYPT_COST || 'false').toLowerCase() === 'true';
const AUTH_BLOCK_LEGACY_DEFAULTS =
  String(
    process.env.AUTH_BLOCK_LEGACY_DEFAULTS ||
      (process.env.NODE_ENV === 'production' ? 'true' : 'false')
  ).toLowerCase() === 'true';

const LEGACY_DEFAULT_CREDENTIALS = new Map([
  ['zzeta', 'GONZA123'],
  ['gonzabarber', 'barber312'],
]);

function extractBcryptCost(passwordHash) {
  const match = String(passwordHash || '').match(/^\$2[abxy]?\$(\d{2})\$/i);
  return match ? Number(match[1]) : null;
}

function isLegacyDefaultCredential(username, password) {
  const expected = LEGACY_DEFAULT_CREDENTIALS.get(String(username || '').toLowerCase());
  if (!expected) return false;
  return String(password || '') === expected;
}

function validateStrongPassword(password) {
  const value = String(password || '');
  if (value.length < 10) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  return true;
}

async function login(username, password) {
  const normalizedUsername = String(username || '').trim();
  const user = usersRepo.findByUsername(normalizedUsername);

  if (!user) {
    const error = new Error('Credenciales incorrectas');
    error.status = 401;
    throw error;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    const error = new Error('Credenciales incorrectas');
    error.status = 401;
    throw error;
  }

  if (
    AUTH_BLOCK_LEGACY_DEFAULTS &&
    isLegacyDefaultCredential(normalizedUsername, password)
  ) {
    const error = new Error(
      'Credencial legacy bloqueada en produccion. Cambia la password del usuario.'
    );
    error.status = 403;
    throw error;
  }

  const hashCost = extractBcryptCost(user.passwordHash);
  if (
    AUTH_ENFORCE_MIN_BCRYPT_COST &&
    Number.isFinite(hashCost) &&
    hashCost < AUTH_MIN_BCRYPT_COST
  ) {
    const error = new Error(
      `La password actual usa hash debil (cost ${hashCost}). Rotala para continuar.`
    );
    error.status = 403;
    throw error;
  }

  const token = jwtSecrets.sign(
    {
      user_id: user.id,
      barber_id: user.barber_id,
      role: user.role,
    },
    { expiresIn: '8h' }
  );

  return { token };
}

async function rotatePassword({ userId, currentPassword, newPassword }) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId)) {
    const err = new Error('Usuario invalido');
    err.status = 400;
    throw err;
  }

  if (normalizedUserId <= 0) {
    const err = new Error(
      'Este usuario se administra por PANEL_USERS_JSON. Rota el hash desde secrets.'
    );
    err.status = 400;
    throw err;
  }

  const user = usersRepo.findById(normalizedUserId);
  if (!user) {
    const err = new Error('Usuario no encontrado');
    err.status = 404;
    throw err;
  }

  const valid = await bcrypt.compare(String(currentPassword || ''), user.passwordHash);
  if (!valid) {
    const err = new Error('Credenciales incorrectas');
    err.status = 401;
    throw err;
  }

  if (String(currentPassword || '') === String(newPassword || '')) {
    const err = new Error('La nueva password debe ser diferente');
    err.status = 400;
    throw err;
  }

  if (!validateStrongPassword(newPassword)) {
    const err = new Error(
      'Password debil. Requiere minimo 10 caracteres con mayuscula, minuscula y numero.'
    );
    err.status = 400;
    throw err;
  }

  const newHash = await bcrypt.hash(String(newPassword), AUTH_BCRYPT_ROUNDS);
  const update = usersRepo.updatePasswordHash({
    id: normalizedUserId,
    passwordHash: newHash,
  });
  if (Number(update?.changes || 0) < 1) {
    const err = new Error('No se pudo actualizar la password');
    err.status = 500;
    throw err;
  }

  return {
    ok: true,
    message: 'Password actualizada correctamente',
  };
}

module.exports = {
  login,
  rotatePassword,
};
