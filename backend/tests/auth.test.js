const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = `zzeta.auth.${Date.now()}.db`;

const app = require('../index');

describe('Auth endpoints', () => {
  test('Login exitoso devuelve token', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({
        username: 'zzeta',
        password: 'GONZA123',
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.token).toBeDefined();
  });

  test('Login con credenciales incorrectas falla', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({
        username: 'zzeta',
        password: 'incorrecto',
      });

    expect(response.statusCode).toBe(401);
  });

  test('Usuario autenticado puede rotar su password y volver a loguear', async () => {
    const login = await request(app).post('/auth/login').send({
      username: 'gonzabarber',
      password: 'barber312',
    });
    expect(login.statusCode).toBe(200);

    const rotate = await request(app)
      .post('/auth/rotate-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        currentPassword: 'barber312',
        newPassword: 'BarberSecure312',
      });
    expect(rotate.statusCode).toBe(200);
    expect(rotate.body.ok).toBe(true);

    const oldLogin = await request(app).post('/auth/login').send({
      username: 'gonzabarber',
      password: 'barber312',
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await request(app).post('/auth/login').send({
      username: 'gonzabarber',
      password: 'BarberSecure312',
    });
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.body.token).toBeDefined();
  });
});
