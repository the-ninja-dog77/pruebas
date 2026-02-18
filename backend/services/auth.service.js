const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const usersRepo = require('../repositories/users.repository');

async function login(username, password) {
  const user = usersRepo.findByUsername(username);

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

  const token = jwt.sign(
    {
      user_id: user.id,
      barber_id: user.barber_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  return { token };
}

module.exports = { login };
