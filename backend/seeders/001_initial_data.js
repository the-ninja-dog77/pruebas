const bcrypt = require('bcrypt');

const SEED_LEGACY_DEFAULT_USERS =
  String(
    process.env.SEED_LEGACY_DEFAULT_USERS ||
      (process.env.NODE_ENV === 'production' ? 'false' : 'true')
  ).toLowerCase() === 'true';

module.exports.up = function (db) {
  if (SEED_LEGACY_DEFAULT_USERS) {
    // Usuario admin legado.
    const existingUser = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get('zzeta');

    if (!existingUser) {
      const passwordHash = bcrypt.hashSync('GONZA123', 10);

      db.prepare(`
        INSERT INTO users (username, passwordHash, role, barber_id)
        VALUES (?, ?, ?, ?)
      `).run('zzeta', passwordHash, 'admin', 1);
    }

    // Usuario barbero legado para app movil.
    const existingBarberUser = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get('gonzabarber');

    if (!existingBarberUser) {
      const passwordHash = bcrypt.hashSync('barber312', 10);

      db.prepare(`
        INSERT INTO users (username, passwordHash, role, barber_id)
        VALUES (?, ?, ?, ?)
      `).run('gonzabarber', passwordHash, 'barber', 1);
    }
  }

  // Cliente base
  const existingCliente = db
    .prepare('SELECT * FROM clientes WHERE id = ?')
    .get('cliente_console_1');

  if (!existingCliente) {
    db.prepare(`
      INSERT INTO clientes (id, nombre, estado)
      VALUES (?, ?, ?)
    `).run('cliente_console_1', 'Cliente Consola', 'idle');
  }
};
