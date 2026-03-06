const request = require('supertest');
const db = require('../database');
const turnosRepo = require('../repositories/turnos.repository');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'zzeta_super_secreto';
process.env.DB_PATH = `zzeta.meta.${Date.now()}.db`;
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_TOKEN = 'test_token';
process.env.WHATSAPP_GRAPH_VERSION = 'v24.0';
process.env.BOT_MIN_LEAD_MINUTES = '0';

const app = require('../index');

describe('WhatsApp webhook conversation flow', () => {
  const outboundMessages = [];

  beforeAll(() => {
    global.fetch = jest.fn(async (_url, opts) => {
      const payload = JSON.parse(opts.body);
      outboundMessages.push(payload.text.body);

      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.test' }] }),
        text: async () => '',
      };
    });
  });

  beforeEach(() => {
    outboundMessages.length = 0;
    db.prepare('DELETE FROM turnos').run();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  function messagePayload(text, from = '595985544421') {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from,
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  test('advances from intent to confirmation', async () => {
    const sequence = [
      'hola',
      'turno',
      'corte de pelo',
      '31/12/2099',
      '15:00',
      'Juan Perez',
      'efectivo',
      'confirmar',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, '595985544421'));

      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[0]).toContain('escribi "turno"');
    expect(outboundMessages[1]).toContain('Que servicio queres');
    expect(outboundMessages[2]).toContain('Para que fecha queres');
    expect(outboundMessages[3]).toContain('Horarios disponibles para 2099-12-31');
    expect(outboundMessages[4]).toContain('A nombre de quien');
    expect(outboundMessages[5]).toContain('metodo de pago');
    expect(outboundMessages[6]).toContain('Si queres confirmar, responde "confirmar"');
    expect(outboundMessages[7]).toContain('turno confirmado');
    expect(outboundMessages[7]).toContain('Pago: Efectivo');
  });

  test('does not confirm when user says no', async () => {
    const sequence = [
      'turno',
      'corte',
      '30/12/2099',
      '15:00',
      'Ana',
      'tarjeta',
      'y si no quiero?',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, '595985544422'));

      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('No se confirmo todavia');
  });

  test('asks for date when availability is requested from idle', async () => {
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('que horarios manejas?', '595985544423'));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Decime la fecha');
  });

  test('detects slot occupied when panel already booked that hour', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });

    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const fecha = '2099-12-31';
    const createFromPanel = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora: '10:00',
        servicio: 'Corte',
        precio: 30000,
      });

    expect(createFromPanel.statusCode).toBe(201);

    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`hay turno el ${fecha} a las 10?`, '595985544424'));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('no esta disponible');
  });

  test('after deleting a panel booking, bot reports the slot as available again', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const fecha = '2099-12-30';
    const hora = '11:00';
    const from = '595985544426';
    const ip = '10.0.0.226';

    const createFromPanel = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora,
        servicio: 'Corte',
        precio: 30000,
      });
    expect(createFromPanel.statusCode).toBe(201);

    const unavailableCheck = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`hay turno el ${fecha} a las ${hora}?`, from));
    expect(unavailableCheck.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('no esta disponible');

    const removeFromPanel = await request(app)
      .delete(`/api/barber-panel/day/${fecha}/turnos/${createFromPanel.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removeFromPanel.statusCode).toBe(200);

    const availableCheck = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`hay turno el ${fecha} a las ${hora}?`, from));
    expect(availableCheck.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('esta disponible');
  });

  test('re-validates slot instantly when user moves from inquiry to reservation intent', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const fecha = '2099-12-22';
    const hora = '09:00';
    const from = '595985544429';
    const ip = '10.0.0.229';

    const freeCheck = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`hay turno el ${fecha} a las ${hora}?`, from));
    expect(freeCheck.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('esta disponible');

    const createFromPanel = await request(app)
      .post(`/api/barber-panel/day/${fecha}/turnos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        hora,
        servicio: 'Corte',
        precio: 30000,
      });
    expect(createFromPanel.statusCode).toBe(201);

    const reserveIntent = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`si, quiero reservar turno el ${fecha} a las ${hora}`, from));
    expect(reserveIntent.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('se ocupo recien');
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Decime otra hora');
  });

  test('reassures availability on follow-up "seguro?" before selecting service', async () => {
    const from = '595985544425';
    const fecha = '2099-12-31';

    const first = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`hola tienes un turno el ${fecha} a las 09:00?`, from));

    expect(first.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('esta disponible');

    const second = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('seguro?', from));

    expect(second.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('sigue disponible');
  });

  test('rejects past date before asking for hour', async () => {
    const from = '595985544426';

    const sequence = [
      'turno',
      'corte',
      '2000-01-01',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));

      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('fecha ya paso');
  });

  test('returns past-date message when asking availability for an old date', async () => {
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('hay horarios para 2000-01-01?', '595985544427'));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('ya paso');
  });

  test('stores provided customer name and payment method in barber panel day view', async () => {
    const from = '595985544428';
    const fecha = '2099-12-31';
    const sequence = [
      'turno',
      'corte',
      fecha,
      '12:00',
      'Carlos Gomez',
      'transferencia',
      'confirmar',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));

      expect(res.statusCode).toBe(200);
    }

    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });

    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);

    expect(day.statusCode).toBe(200);
    const found = day.body.agenda.find(t => t.hora === '12:00' && t.cliente === 'Carlos Gomez');
    expect(Boolean(found)).toBe(true);
    expect(found.metodo_pago).toBe('Transferencia/QR');
  });

  test('cancels booking by name and date via WhatsApp', async () => {
    const from = '595985544429';
    const fecha = '2099-12-30';
    const ip = '10.0.0.228';
    const sequenceCreate = [
      'turno',
      'corte',
      fecha,
      '13:00',
      'Mario Lopez',
      'efectivo',
      'confirmar',
    ];

    for (const msg of sequenceCreate) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const cancel = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`cancelar turno de Mario Lopez el ${fecha}`, from));

    expect(cancel.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('cancele el turno');

    const login = await request(app)
      .post('/auth/login')
      .set('x-forwarded-for', ip)
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('x-forwarded-for', ip)
      .set('Authorization', `Bearer ${token}`);
    expect(day.statusCode).toBe(200);
    const exists = day.body.agenda.some(t => t.hora === '13:00' && t.cliente === 'Mario Lopez');
    expect(exists).toBe(false);
  });

  test('handles reminder confirmation with colloquial response', async () => {
    const from = '595985544431';
    const fecha = '2099-12-29';
    const sequenceCreate = [
      'turno',
      'corte',
      fecha,
      '10:00',
      'Pedro Ruiz',
      'efectivo',
      'confirmar',
    ];

    for (const msg of sequenceCreate) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const created = turnosRepo
      .getByFecha(fecha, 1)
      .find(t => t.cliente_id === from && t.hora === '10:00');
    expect(Boolean(created)).toBe(true);
    turnosRepo.marcarRecordatorioEnviado(created.id, { esperandoRespuesta: true });

    const confirm = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('dale rey voy a asistir', from));
    expect(confirm.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('te esperamos');
  });

  test('handles reminder cancellation quickly', async () => {
    const from = '595985544432';
    const fecha = '2099-12-28';
    const sequenceCreate = [
      'turno',
      'corte',
      fecha,
      '11:00',
      'Lucas Perez',
      'efectivo',
      'confirmar',
    ];

    for (const msg of sequenceCreate) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const created = turnosRepo
      .getByFecha(fecha, 1)
      .find(t => t.cliente_id === from && t.hora === '11:00');
    expect(Boolean(created)).toBe(true);
    turnosRepo.marcarRecordatorioEnviado(created.id, { esperandoRespuesta: true });

    const cancel = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('no voy a poder ir, cancelar', from));
    expect(cancel.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('cancele tu turno');
  });

  test('reschedules booking by name and date via WhatsApp', async () => {
    const from = '595985544430';
    const fecha = '2099-12-29';
    const ip = '10.0.0.230';
    const sequenceCreate = [
      'turno',
      'corte',
      fecha,
      '14:00',
      'Laura Diaz',
      'tarjeta',
      'confirmar',
    ];

    for (const msg of sequenceCreate) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const startReschedule = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`reprogramar turno de Laura Diaz el ${fecha}`, from));
    expect(startReschedule.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Decime la nueva fecha y hora');

    const applyReschedule = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`${fecha} 16:00`, from));
    expect(applyReschedule.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('reprogramado');

    const login = await request(app)
      .post('/auth/login')
      .set('x-forwarded-for', ip)
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('x-forwarded-for', ip)
      .set('Authorization', `Bearer ${token}`);
    expect(day.statusCode).toBe(200);

    const movedExists = day.body.agenda.some(
      t => t.hora === '16:00' && t.cliente === 'Laura Diaz'
    );
    expect(movedExists).toBe(true);
  });

  test('cancels nearest upcoming booking with natural cancel message', async () => {
    const from = '595985544431';
    const fecha = '2099-12-28';
    const ip = '10.0.0.231';
    const createSequence = [
      'turno',
      'corte',
      fecha,
      '11:00',
      'Pedro Ruiz',
      'efectivo',
      'confirmar',
    ];

    for (const msg of createSequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const cancel = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('bro quiero cancelar no voy a poder ir ese dia', from));

    expect(cancel.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('cancele tu turno');

    const login = await request(app)
      .post('/auth/login')
      .set('x-forwarded-for', ip)
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('x-forwarded-for', ip)
      .set('Authorization', `Bearer ${token}`);
    expect(day.statusCode).toBe(200);

    const stillExists = day.body.agenda.some(
      t => t.hora === '11:00' && t.cliente === 'Pedro Ruiz'
    );
    expect(stillExists).toBe(false);
  });

  test('cancels nearest upcoming booking when user says "no creo poder ir" without explicit "cancelar"', async () => {
    const from = '595985544451';
    const fecha = '2099-12-28';
    const ip = '10.0.0.251';
    const createSequence = [
      'turno',
      'corte',
      fecha,
      '12:00',
      'Fernando Vallejos',
      'efectivo',
      'confirmar',
    ];

    for (const msg of createSequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const cancel = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('no creo poder ir ese dia', from));

    expect(cancel.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('cancele tu turno');

    const login = await request(app)
      .post('/auth/login')
      .set('x-forwarded-for', ip)
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    expect(login.statusCode).toBe(200);
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('x-forwarded-for', ip)
      .set('Authorization', `Bearer ${token}`);
    expect(day.statusCode).toBe(200);

    const stillExists = day.body.agenda.some(
      t => t.hora === '12:00' && t.cliente === 'Fernando Vallejos'
    );
    expect(stillExists).toBe(false);
  });

  test('parses "hoy" using business timezone context and advances to name when slot is valid', async () => {
    const from = '595985544453';
    const nowParts = require('../services/businessTime.service').getNowParts();
    const targetDate = nowParts.fecha;
    const hour = Number(String(nowParts.hora || '00:00').split(':')[0]);
    const nextHour = Math.min(19, Math.max(9, hour + 1));
    const slot = `${String(nextHour).padStart(2, '0')}:00`;

    const sequence = [
      'turno',
      'corte',
      'hoy',
      `a las ${nextHour}`,
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const last = outboundMessages[outboundMessages.length - 1];
    if (last.includes('no esta disponible')) {
      expect(last).toContain(targetDate);
    } else {
      expect(last).toContain('A nombre de quien');
    }
    expect(slot).toMatch(/^\d{2}:00$/);
  });

  test('extracts customer name from long natural sentence with "soy ..." cue', async () => {
    const from = '595985544452';
    const fecha = '2099-12-26';
    const ip = '10.0.0.252';
    const sequence = [
      'turno',
      'corte',
      fecha,
      '13:00',
      'quiero un corte soy fernando quiero pagar en efectivo y quiero un corte hoy a las 1',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const lastReply = outboundMessages[outboundMessages.length - 1];
    expect(lastReply.toLowerCase()).not.toContain('me falta: nombre');
  });

  test('cleans noisy name when message includes "soy ... y quiero pagar"', async () => {
    const from = '595985544454';
    const fecha = '2099-12-26';
    const ip = '10.0.0.254';
    const sequence = [
      'turno',
      'corte',
      fecha,
      '13:00',
      'soy fernando y quiero pagar en efectivo bro',
    ];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const lastReply = outboundMessages[outboundMessages.length - 1].toLowerCase();
    expect(lastReply).toContain('fernando');
    expect(lastReply).not.toContain('quiero pagar');
  });

  test('answers availability for "esta tarde" query without forcing full booking fields', async () => {
    const from = '595985544455';
    const ip = '10.0.0.255';
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('hola tenes libre esta tarde a las 3?', from));

    expect(res.statusCode).toBe(200);
    const lastReply = outboundMessages[outboundMessages.length - 1].toLowerCase();
    const looksLikeAvailability =
      lastReply.includes('esta disponible') ||
      lastReply.includes('no esta disponible') ||
      lastReply.includes('horarios disponibles para');
    expect(looksLikeAvailability).toBe(true);
    expect(lastReply).not.toContain('me falta: servicio');
  });

  test('replies naturally to short ack in idle state', async () => {
    const from = '595985544456';
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('dale dale', from));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Cualquier cosa escribime "turno"');
  });

  test('responds naturally to thanks in idle state', async () => {
    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('gracias bro', '595985544432'));

    expect(res.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('De nada');
  });

  test('limits one active booking per number unless explicitly booking for another person', async () => {
    const from = '595985544433';
    const fecha = '2099-12-26';

    const firstBooking = [
      'turno',
      'corte',
      fecha,
      '09:00',
      'Fernando Vallejos',
      'efectivo',
      'confirmar',
    ];

    for (const msg of firstBooking) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const secondUntilName = ['turno', 'corte', fecha, '10:00', 'Fernando Vallejos'];
    for (const msg of secondUntilName) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('Ya tenes un turno activo');

    const explicitOtherName = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('a nombre de Juan Perez', from));
    expect(explicitOtherName.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('metodo de pago');

    const finishSecondBooking = ['tarjeta', 'confirmar'];
    for (const msg of finishSecondBooking) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('Listo Juan Perez');
  });

  test('handles "reprogramar mi turno" without requiring name/date if only one upcoming booking exists', async () => {
    const from = '595985544434';
    const fecha = '2099-12-24';
    const createSequence = [
      'turno',
      'corte',
      fecha,
      '09:00',
      'Sofia Acosta',
      'efectivo',
      'confirmar',
    ];

    for (const msg of createSequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const start = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('reprogramar mi turno porfa', from));
    expect(start.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Encontre tu proximo turno');

    const apply = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`${fecha} 10:00`, from));
    expect(apply.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('reprogramado');
  });

  test('thanks during an active flow resets gracefully instead of insisting on another hour', async () => {
    const from = '595985544435';
    const seq = ['turno', 'corte', '2099-12-23'];
    for (const msg of seq) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const thanks = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('gracias entonces', from));
    expect(thanks.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('De nada');
  });

  test('does not get stuck on unavailable-hour loop when user asks to reschedule or thanks', async () => {
    const from = '595985544436';
    const fecha = '2099-12-22';
    const ip = '10.0.0.236';
    const createSequence = [
      'turno',
      'corte',
      fecha,
      '11:00',
      'Bruno Rojas',
      'efectivo',
      'confirmar',
    ];

    for (const msg of createSequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const asksSameSlot = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(`turno para ${fecha} a las 11:00 (Corte)`, from));
    expect(asksSameSlot.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Ya tenes un turno activo');

    const reschedule = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('reprogramar mi turno porfa', from));
    expect(reschedule.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Encontre tu proximo turno');

    const thanks = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('gracias entonces', from));
    expect(thanks.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('De nada');
  });

  test('accepts "mismo dia de recien" by reusing the last mentioned date', async () => {
    const from = '595985544437';
    const fecha = '2099-12-21';
    const ip = '10.0.0.237';
    const createAndCancel = [
      'turno',
      'corte',
      fecha,
      '16:00',
      'Nadia Benitez',
      'efectivo',
      'confirmar',
      'quiero cancelar no voy a poder ir ese dia',
      'turno',
      'corte',
      'para el mismo dia de recien',
    ];

    for (const msg of createAndCancel) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain(
      `Horarios disponibles para ${fecha}`
    );
  });

  test('understands "de las 3" as 15:00 in booking flow', async () => {
    const from = '595985544438';
    const fecha = '2099-12-29';
    const ip = '10.0.0.238';
    const sequence = ['turno', 'corte', fecha, 'quiero el turno de las 3'];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('understands "las 3:00" as 15:00 when user does not specify am/pm', async () => {
    const from = '595985544439';
    const fecha = '2099-12-30';
    const ip = '10.0.0.239';
    const sequence = ['turno', 'corte', fecha, 'las 3:00'];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('understands "las 4" as 16:00', async () => {
    const from = '595985544440';
    const fecha = '2099-12-30';
    const ip = '10.0.0.240';
    const sequence = ['turno', 'corte', fecha, 'las 4'];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('understands "las 16" as 16:00', async () => {
    const from = '595985544441';
    const fecha = '2099-12-30';
    const ip = '10.0.0.241';
    const sequence = ['turno', 'corte', fecha, 'las 16'];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('understands spoken-style "las cuatro" as 16:00', async () => {
    const from = '595985544442';
    const fecha = '2099-12-30';
    const ip = '10.0.0.242';
    const sequence = ['turno', 'corte', fecha, 'las cuatro'];

    for (const msg of sequence) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('keeps active flow when user says thanks before final confirmation', async () => {
    const from = '595985544443';
    const fecha = '2099-12-30';
    const ip = '10.0.0.243';
    const setup = ['turno', 'corte', fecha, '15:00', 'Fernando Vallejos', 'efectivo'];

    for (const msg of setup) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const thanks = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('gracias bro', from));
    expect(thanks.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('De nada');
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Si queres seguir');

    const confirm = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('confirmar', from));
    expect(confirm.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('turno confirmado');
  });

  test('returns context-aware help when user asks "que me falta?" mid flow', async () => {
    const from = '595985544444';
    const ip = '10.0.0.244';
    const seq = ['turno', 'corte'];
    for (const msg of seq) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const help = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('bro que me falta?', from));
    expect(help.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('falta la fecha');
  });

  test('asks user to choose when cancel and reschedule intents are mixed in one message', async () => {
    const from = '595985544445';
    const ip = '10.0.0.245';
    const mixed = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('quiero cancelar y reprogramar turno', from));

    expect(mixed.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('cancelar o reprogramar');
  });

  test('requests explicit confirmation when date/time are corrected in the same message', async () => {
    const from = '595985544446';
    const ip = '10.0.0.246';
    const seq = ['turno', 'corte', 'quiero el 2099-12-27 a las 4 no mejor 2099-12-28 a las 5'];

    for (const msg of seq) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const prompt = outboundMessages[outboundMessages.length - 1];
    expect(prompt).toContain('Para evitar errores');
    expect(prompt).toContain('fecha 2099-12-28');
    expect(prompt).toContain('hora 17:00');

    const confirm = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('si', from));
    expect(confirm.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('allows a second correction while temporal confirmation is pending', async () => {
    const from = '595985544447';
    const ip = '10.0.0.247';
    const setup = ['turno', 'corte', '2099-12-27 a las 4 no, mejor 2099-12-28 a las 5'];

    for (const msg of setup) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const correction = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('mejor 2099-12-29 a las 6', from));
    expect(correction.statusCode).toBe(200);

    const correctionPrompt = outboundMessages[outboundMessages.length - 1];
    expect(correctionPrompt).toContain('Seguimos pendientes de esta confirmacion');
    expect(correctionPrompt).toContain('fecha 2099-12-29');
    expect(correctionPrompt).toContain('hora 18:00');

    const confirm = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('si', from));
    expect(confirm.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('clears temporal pending when user rejects and accepts fresh date/time', async () => {
    const from = '595985544448';
    const ip = '10.0.0.248';
    const setup = ['turno', 'corte', '2099-12-27 a las 4 no mejor 2099-12-28 a las 5'];

    for (const msg of setup) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const reject = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('no', from));
    expect(reject.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Decime de nuevo fecha y hora');

    const freshTemporal = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('2099-12-30 a las 16', from));
    expect(freshTemporal.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('accepts natural confirmation style while temporal confirmation is pending', async () => {
    const from = '595985544449';
    const ip = '10.0.0.249';
    const setup = ['turno', 'corte', '2099-12-27 a las 4 no mejor 2099-12-28 a las 5'];

    for (const msg of setup) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const naturalConfirm = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('si broooo, ese dia', from));
    expect(naturalConfirm.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('A nombre de quien');
  });

  test('does not keep looping temporal confirmation for availability questions', async () => {
    const from = '595985544450';
    const ip = '10.0.0.250';
    const setup = ['turno', 'corte', '2099-12-27 a las 4 no mejor 2099-12-28 a las 5'];

    for (const msg of setup) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const availability = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('si broooo que turnos tenes ese dia', from));
    expect(availability.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).not.toContain(
      'Seguimos pendientes de esta confirmacion'
    );
  });

  test('one-shot natural message collects booking data without rigid comma format', async () => {
    const from = '595985544451';
    const ip = '10.0.0.251';
    const fecha = '2099-12-31';
    const hora = '15:00';

    const oneShot = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(
        messagePayload(
          `quiero un corte para el ${fecha} a las 3, soy fernando vallejos y pago en efectivo`,
          from
        )
      );
    expect(oneShot.statusCode).toBe(200);
    const reply = outboundMessages[outboundMessages.length - 1];
    expect(reply).toContain(fecha);
    expect(reply).toContain(hora);
    expect(reply.toLowerCase()).toContain('confirm');
  });

  test('understands mixed one-shot message with typos and combined service intent', async () => {
    const from = '595985544455';
    const ip = '10.0.0.255';
    const fecha = '2099-12-30';
    const input =
      `bro qiero un turno tipo 3 el ${fecha}, quiero un corte y hacerme la barba tambien, soy fernando vallejos y pago en efectivo`;

    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(input, from));
    expect(res.statusCode).toBe(200);

    const reply = outboundMessages[outboundMessages.length - 1].toLowerCase();
    expect(reply).toContain(fecha);
    expect(reply).toContain('15:00');
    expect(reply).toContain('corte + barba');
    expect(reply).toContain('fernando vallejos');
    expect(reply).toContain('efectivo');
  });

  test('understands "3 de la tarde" as 15:00 in one-shot booking', async () => {
    const from = '595985544456';
    const ip = '10.0.0.56';
    const fecha = '2099-12-29';
    const input = `quiero corte para el ${fecha} a las 3 de la tarde, soy juan perez y pago en efectivo`;

    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(input, from));
    expect(res.statusCode).toBe(200);

    const reply = outboundMessages[outboundMessages.length - 1].toLowerCase();
    expect(reply).toContain(fecha);
    expect(reply).toContain('15:00');
    expect(reply).toContain('juan perez');
    expect(reply).toContain('efectivo');
  });

  test('accepts explicit single-token name when user says "soy fer"', async () => {
    const from = '595985544457';
    const ip = '10.0.0.57';
    const fecha = '2099-12-28';
    const input = `quiero corte el ${fecha} a las 4, soy fer y pago en efectivo`;

    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(input, from));
    expect(res.statusCode).toBe(200);

    const reply = outboundMessages[outboundMessages.length - 1].toLowerCase();
    expect(reply).toContain(fecha);
    expect(reply).toContain('16:00');
    expect(reply).toContain('fer');
    expect(reply).toContain('efectivo');
  });

  test('accepts "correcto" as confirmation on awaiting_confirm stage', async () => {
    const from = '595985544452';
    const ip = '10.0.0.252';
    const seq = [
      'turno',
      'corte',
      '2099-12-31',
      '16:00',
      'Fernando Vallejos',
      'efectivo',
    ];

    for (const msg of seq) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const confirm = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('correcto', from));
    expect(confirm.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('turno confirmado');
  });

  test('understands english one-shot booking message without rigid format', async () => {
    const from = '595985544453';
    const ip = '10.0.0.253';
    const input =
      'hi bro, i want a haircut for 2099-12-31 at 3 pm, my name is John Doe and i pay cash';

    const res = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload(input, from));
    expect(res.statusCode).toBe(200);

    const reply = outboundMessages[outboundMessages.length - 1].toLowerCase();
    expect(reply).toContain('2099-12-31');
    expect(reply).toContain('15:00');
    expect(reply).toContain('john doe');
    expect(reply).toContain('efectivo');
  });

  test('accepts "yes bro" as confirmation in awaiting_confirm stage', async () => {
    const from = '595985544454';
    const ip = '10.0.0.254';
    const seq = [
      'turno',
      'corte',
      '2099-12-31',
      '17:00',
      'Pedro Gomez',
      'efectivo',
    ];

    for (const msg of seq) {
      const res = await request(app)
        .post('/meta-webhook')
        .set('x-webhook-debug', '1')
        .set('x-forwarded-for', ip)
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const confirm = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .set('x-forwarded-for', ip)
      .send(messagePayload('yes bro', from));
    expect(confirm.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('turno confirmado');
  });
});
