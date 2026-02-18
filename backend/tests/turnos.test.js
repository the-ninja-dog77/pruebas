const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = 'zzeta.test.db';

const app = require('../index');

let token;

beforeAll(async () => {
  const login = await request(app)
    .post('/auth/login')
    .send({
      username: 'zzeta',
      password: 'GONZA123',
    });

  token = login.body.token;
});

describe('Turnos protegidos', () => {
  test('Requiere token', async () => {
    const response = await request(app)
      .get('/turnos/todos');

    expect(response.statusCode).toBe(401);
  });

  test('Con token devuelve turnos', async () => {
    const response = await request(app)
      .get('/turnos/todos')
      .set('Authorization', `Bearer ${token}`);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
