const request = require('supertest');
const businessHours = require('../services/businessHours.service');
const barberPanelRepo = require('../repositories/barberPanel.repository');
const businessTime = require('../services/businessTime.service');

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

function getOpenDateFrom(baseIso, skipOpenDays = 0) {
  const base = new Date(`${baseIso}T00:00:00`);
  let skipped = 0;
  for (let i = 0; i < 45; i += 1) {
    const current = new Date(base);
    current.setDate(base.getDate() + i);
    const fecha = isoDate(current);
    if (businessHours.getSlotsForDate(fecha).length > 0) {
      if (skipped >= skipOpenDays) return fecha;
      skipped += 1;
    }
  }
  throw new Error('No se encontro una fecha abierta desde base');
}

function getRecentOpenDateInCurrentWeek() {
  const now = new Date();
  for (let i = 0; i <= 6; i += 1) {
    const current = new Date(now);
    current.setDate(now.getDate() - i);
    const fecha = isoDate(current);
    if (businessHours.getSlotsForDate(fecha).length > 0) {
      return fecha;
    }
  }
  return getNextOpenDate();
}

function addMinutesToHora(hora, minutes) {
  const [h, m] = String(hora || '00:00').split(':').map(Number);
  const base = (h * 60) + m + Number(minutes || 0);
  const normalized = ((base % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
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
    expect(create.body.precio).toBe(40000);

    const dayAfter = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);

    expect(dayAfter.statusCode).toBe(200);
    const createdInAgenda = dayAfter.body.agenda.some(
      t => t.hora === hora && t.servicio === 'Corte'
    );
    expect(createdInAgenda).toBe(true);

    const summary = barberPanelRepo.getDaySummary({
      barberId: 1,
      fecha,
      hora: '00:00',
    });
    expect(Number(summary.totalTurnos || 0)).toBeGreaterThan(0);
  });

  test('elimina un turno desde /api/barber-panel/day/:fecha/turnos/:id y libera el horario', async () => {
    const fecha = getNextOpenDate();

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);
    expect(day.statusCode).toBe(200);
    expect(day.body.disponibles.length).toBeGreaterThan(0);

    const hora = day.body.disponibles[0];
    const create = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora,
        servicio: 'Corte',
        precio: 40000,
      });
    expect(create.statusCode).toBe(201);

    const remove = await request(app)
      .delete(`/api/barber-panel/day/${fecha}/turnos/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(remove.statusCode).toBe(200);
    expect(remove.body.message).toBe('Turno eliminado');

    const dayAfter = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);
    expect(dayAfter.statusCode).toBe(200);
    expect(dayAfter.body.agenda.some(t => t.id === create.body.id)).toBe(false);
    expect(dayAfter.body.disponibles.includes(hora)).toBe(true);
  });

  test('confirma turno completado y lo refleja en balance semanal', async () => {
    const fecha = getRecentOpenDateInCurrentWeek();
    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);

    expect(day.statusCode).toBe(200);
    expect(day.body.disponibles.length).toBeGreaterThan(0);

    const hora = day.body.disponibles[0];
    const create = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora,
        servicio: 'Corte',
        precio: 40000,
      });
    expect(create.statusCode).toBe(201);

    const complete = await request(app)
      .post(`/api/barber-panel/turnos/${create.body.id}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(complete.statusCode).toBe(200);
    expect(Number(complete.body.completado)).toBe(1);

    const balance = await request(app)
      .get('/api/barber-panel/balance?range=week')
      .set('Authorization', `Bearer ${token}`);

    expect(balance.statusCode).toBe(200);
    expect(Number(balance.body.confirmedTurnos)).toBeGreaterThan(0);
    expect(Number(balance.body.amount)).toBeGreaterThanOrEqual(40000);
  });

  test('muestra completionPrompt sin proximo turno cuando ya pasaron 30 minutos', async () => {
    const fecha = getOpenDateFrom('2099-11-01', 2);
    const slots = businessHours.getSlotsForDate(fecha);
    expect(slots.length).toBeGreaterThan(0);
    const hora = slots.includes('13:00') ? '13:00' : slots[0];

    const create = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora,
        servicio: 'Corte',
        precio: 40000,
      });
    expect(create.statusCode).toBe(201);

    const originalGetNowParts = businessTime.getNowParts;
    businessTime.getNowParts = () => ({
      fecha,
      hora: addMinutesToHora(hora, 35),
      timezone: 'test-fixed',
    });

    try {
      const summary = await request(app)
        .get('/api/barber-panel/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(summary.statusCode).toBe(200);
      expect(summary.body.completionPrompt).toBeTruthy();
      expect(summary.body.completionPrompt.mode).toBe('after_turno');
      expect(Number(summary.body.completionPrompt.turnoId)).toBe(Number(create.body.id));
      expect(Number(summary.body.completionPrompt.minutesAfterStart)).toBeGreaterThanOrEqual(30);
    } finally {
      businessTime.getNowParts = originalGetNowParts;
    }
  });

  test('si hay multiples pendientes sin proximo turno, devuelve primero el mas antiguo', async () => {
    const fecha = getOpenDateFrom('2099-10-01', 3);
    const slots = businessHours.getSlotsForDate(fecha);
    expect(slots.length).toBeGreaterThan(2);
    const horaA = slots.includes('09:00') ? '09:00' : slots[0];
    const horaB = slots.includes('10:00') ? '10:00' : slots[1];

    const createA = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora: horaA,
        servicio: 'Corte',
        precio: 40000,
      });
    expect(createA.statusCode).toBe(201);

    const createB = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora: horaB,
        servicio: 'Barba',
        precio: 10000,
      });
    expect(createB.statusCode).toBe(201);

    const originalGetNowParts = businessTime.getNowParts;
    businessTime.getNowParts = () => ({
      fecha,
      hora: addMinutesToHora(horaB, 40),
      timezone: 'test-fixed',
    });

    try {
      const summary = await request(app)
        .get('/api/barber-panel/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(summary.statusCode).toBe(200);
      expect(summary.body.completionPrompt).toBeTruthy();
      expect(summary.body.completionPrompt.mode).toBe('after_turno');
      expect(Number(summary.body.completionPrompt.turnoId)).toBe(Number(createA.body.id));
      expect(summary.body.completionPrompt.hora).toBe(horaA);
    } finally {
      businessTime.getNowParts = originalGetNowParts;
    }
  });
});
