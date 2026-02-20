const request = require('supertest');
const businessHours = require('../services/businessHours.service');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = `zzeta.panel.${Date.now()}.db`;

const app = require('../index');

function pad2(v) {
  return String(v).padStart(2, '0');
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getNextOpenDate() {
  const base = new Date('2099-12-20T00:00:00');
  for (let i = 0; i < 20; i += 1) {
    const current = new Date(base);
    current.setDate(base.getDate() + i);
    const fecha = isoDate(current);
    if (businessHours.getSlotsForDate(fecha).length > 0) {
      return fecha;
    }
  }
  throw new Error('No se encontro una fecha abierta para el test');
}

describe('Barber panel', () => {
  let token;

  beforeAll(async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });

    token = login.body.token;
  });

  test('crea un turno desde /api/barber-panel/day/:fecha/turnos', async () => {
    const fecha = getNextOpenDate();

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);

    expect(day.statusCode).toBe(200);
    expect(Array.isArray(day.body.disponibles)).toBe(true);
    expect(day.body.disponibles.length).toBeGreaterThan(0);

    const hora = day.body.disponibles[0];

    const create = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora,
        servicio: 'Corte',
        precio: 30000,
      });

    expect(create.statusCode).toBe(201);
    expect(create.body.fecha).toBe(fecha);
    expect(create.body.hora).toBe(hora);
    expect(create.body.servicio).toBe('Corte');
    expect(create.body.precio).toBe(30000);

    const dayAfter = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);

    expect(dayAfter.statusCode).toBe(200);
    const createdInAgenda = dayAfter.body.agenda.some(
      t => t.hora === hora && t.servicio === 'Corte'
    );
    expect(createdInAgenda).toBe(true);
  });
});
