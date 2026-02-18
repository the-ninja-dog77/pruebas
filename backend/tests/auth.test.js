const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = 'zzeta.test.db';

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
});
