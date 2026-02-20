const bcrypt = require('bcrypt');

module.exports.up = function (db) {
  // Usuario admin
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

  // Usuario barbero para app movil
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
