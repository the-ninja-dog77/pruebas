const request = require('supertest');

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
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const cancel = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`cancelar turno de Mario Lopez el ${fecha}`, from));

    expect(cancel.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('cancele el turno');

    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);
    const exists = day.body.agenda.some(t => t.hora === '13:00' && t.cliente === 'Mario Lopez');
    expect(exists).toBe(false);
  });

  test('reschedules booking by name and date via WhatsApp', async () => {
    const from = '595985544430';
    const fecha = '2099-12-29';
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
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const startReschedule = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`reprogramar turno de Laura Diaz el ${fecha}`, from));
    expect(startReschedule.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('Decime la nueva fecha y hora');

    const applyReschedule = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload(`${fecha} 16:00`, from));
    expect(applyReschedule.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('reprogramado');

    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);

    const movedExists = day.body.agenda.some(
      t => t.hora === '16:00' && t.cliente === 'Laura Diaz'
    );
    expect(movedExists).toBe(true);
  });

  test('cancels nearest upcoming booking with natural cancel message', async () => {
    const from = '595985544431';
    const fecha = '2099-12-28';
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
        .send(messagePayload(msg, from));
      expect(res.statusCode).toBe(200);
    }

    const cancel = await request(app)
      .post('/meta-webhook')
      .set('x-webhook-debug', '1')
      .send(messagePayload('bro quiero cancelar no voy a poder ir ese dia', from));

    expect(cancel.statusCode).toBe(200);
    expect(outboundMessages[outboundMessages.length - 1]).toContain('cancele tu turno');

    const login = await request(app)
      .post('/auth/login')
      .send({
        username: 'gonzabarber',
        password: 'barber312',
      });
    const token = login.body.token;

    const day = await request(app)
      .get(`/api/barber-panel/day/${fecha}`)
      .set('Authorization', `Bearer ${token}`);

    const stillExists = day.body.agenda.some(
      t => t.hora === '11:00' && t.cliente === 'Pedro Ruiz'
    );
    expect(stillExists).toBe(false);
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
});
