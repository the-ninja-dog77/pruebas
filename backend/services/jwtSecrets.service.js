const jwt = require('jsonwebtoken');

function splitSecretList(raw) {
  return String(raw || '')
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getJwtSecrets() {
  const current = String(process.env.JWT_SECRET_CURRENT || '').trim();
  const rotationList = splitSecretList(process.env.JWT_SECRET_ROTATION);
  const previous = splitSecretList(process.env.JWT_SECRET_PREVIOUS);
  const legacy = String(process.env.JWT_SECRET || '').trim();

  return unique([current, ...rotationList, ...previous, legacy]);
}

function getSigningSecret() {
  const secrets = getJwtSecrets();
  if (!secrets.length) {
    const err = new Error('JWT secret no configurado');
    err.status = 500;
    throw err;
  }
  return secrets[0];
}

function sign(payload, options = {}) {
  return jwt.sign(payload, getSigningSecret(), options);
}

function verify(token, options = {}) {
  const secrets = getJwtSecrets();
  if (!secrets.length) {
    const err = new Error('JWT secret no configurado');
    err.status = 500;
    throw err;
  }

  let lastErr = null;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret, options);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Token invalido');
}

function getSnapshot() {
  const secrets = getJwtSecrets();
  return {
    secretCount: secrets.length,
    rotationEnabled: secrets.length > 1,
    hasLegacySecret: Boolean(String(process.env.JWT_SECRET || '').trim()),
    hasCurrentSecret: Boolean(String(process.env.JWT_SECRET_CURRENT || '').trim()),
  };
}

module.exports = {
  getJwtSecrets,
  getSnapshot,
  sign,
  verify,
};
