const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = `zzeta.jwt-rotation.${Date.now()}.db`;
process.env.JWT_SECRET_CURRENT = 'jwt_secret_current_test';
process.env.JWT_SECRET_PREVIOUS = 'jwt_secret_previous_test';
delete process.env.JWT_SECRET;

const app = require('../index');

describe('JWT secret rotation compatibility', () => {
  test('accepts tokens signed with previous secret', async () => {
    const previousToken = jwt.sign(
      {
        user_id: 1,
        barber_id: 1,
        role: 'admin',
      },
      process.env.JWT_SECRET_PREVIOUS,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/barber-panel/summary')
      .set('Authorization', `Bearer ${previousToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('totalTurnosHoy');
  });
});
