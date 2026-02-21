const axios = require('axios');
const readline = require('readline');

const API = 'http://localhost:3000';
 
/* ======================================================
   IDENTIDAD DEL CLIENTE — FASE 3.8
   (simula WhatsApp real)
   ====================================================== */

const CLIENTE_ID = 'cliente_console_1';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

/* ======================================================
   CONTEXTO + MEMORIA DE SESIÓN — FASE 3.7
   ====================================================== */

let contexto = {
  barbero: null,              // 'gonza' | 'secundario'
  modoAtencion: null,         // 'turno' | 'llegada'
  servicio: null,
  fecha: hoyISO(),
  hora: null,
  esperandoConfirmacion: false,
};

let ultimoTurnoConfirmado = null;

let memoriaSesion = {
  ultimaHora: null,
  huboConfirmacion: false,
};

/* ======================================================
   UTILIDADES
   ====================================================== */

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function esAfirmacion(msg) {
  return [
    'si','sí','ok','dale','perfecto','confirmo',
    'listo','de una','joya','esta bien','confirmado',
    'claro','vamos','tal cual'
  ].some(p => msg.includes(p));
}

function esCancelacion(msg) {
  return [
    'cancelar','cancelalo','no voy a poder',
    'no puedo','anular','olvidalo'
  ].some(p => msg.includes(p));
}

function esCambio(msg) {
  return [
    'otro','otra','mejor','cambiemos',
    'mas tarde','mas temprano','distinto'
  ].some(p => msg.includes(p));
}

/* ======================================================
   FECHAS
   ====================================================== */

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function sumarDiasISO(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function detectarFecha(msg) {
  if (msg.includes('hoy')) return hoyISO();
  if (msg.includes('mañana')) return sumarDiasISO(1);
  if (msg.includes('pasado mañana')) return sumarDiasISO(2);
  return null;
}

/* ======================================================
   SERVICIO
   ====================================================== */

function detectarServicio(msg) {
  if (msg.includes('corte') && msg.includes('ceja')) return 'Corte + Cejas';
  if (msg.includes('corte') && msg.includes('barba')) return 'Corte + Barba';
  if (msg.includes('corte')) return 'Corte';
  return null;
}

/* ======================================================
   HORA
   ====================================================== */

function detectarHora(msg) {
  if (
    memoriaSesion.ultimaHora &&
    (msg.includes('esa') || msg.includes('la misma') || msg.includes('igual'))
  ) {
    return memoriaSesion.ultimaHora;
  }

  const match = msg.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
  if (!match) return null;

  let h = parseInt(match[1]);
  let m = match[2] ? parseInt(match[2]) : 0;

  if (h < 9) h += 12;

  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

/* ======================================================
   BACKEND
   ====================================================== */

async function mostrarDisponibles() {
  try {
    const barberId = contexto.barbero === 'gonza' ? 1 : 2;
    const res = await axios.get(
      `${API}/turnos/disponibilidad/${contexto.fecha}/${barberId}`
    );
    console.log('📅 Horarios disponibles:');
    console.log(res.data.disponibles.join(', '));
  } catch {
    console.log('⚠️ No pude consultar horarios.');
  }
}

async function crearTurno() {
  try {
    const barberId = contexto.barbero === 'gonza' ? 1 : 2;

    const res = await axios.post(`${API}/turnos`, {
      cliente: 'Cliente WhatsApp',
      cliente_id: CLIENTE_ID,
      servicio: contexto.servicio,
      fecha: contexto.fecha,
      hora: contexto.hora,
      barber_id: barberId,
      origen: 'bot',
    });

    ultimoTurnoConfirmado = res.data;
    memoriaSesion.huboConfirmacion = true;

    console.log('✅ Turno confirmado.');
    console.log(`👤 Barbero: ${contexto.barbero === 'gonza' ? 'Gonza' : 'Secundario'}`);
    console.log(`🕒 ${contexto.hora} — ${contexto.servicio}`);
    console.log('📍 ZZETA Barber Club');

    contexto.esperandoConfirmacion = false;
  } catch (err) {
    console.log(`❌ ${err.response?.data?.message || 'No se pudo crear el turno'}`);
  }
}

/* ======================================================
   PROCESAR MENSAJE
   ====================================================== */

async function procesarMensaje(input) {
  const msg = normalizar(input);

  /* 🔔 RECORDATORIOS — FASE 3.8 (AISLADOS POR CLIENTE) */
  try {
    const res = await axios.get(
      `${API}/turnos/recordatorio/activo/${CLIENTE_ID}`
    );
    const turno = res.data;

    if (turno) {
      if (esAfirmacion(msg)) {
        await axios.post(
          `${API}/turnos/recordatorio/${turno.id}/responder`,
          { accion: 'confirmar' }
        );
        console.log('✅ Turno confirmado. Te esperamos.');
        return;
      }

      if (esCancelacion(msg)) {
        await axios.post(
          `${API}/turnos/recordatorio/${turno.id}/responder`,
          { accion: 'cancelar' }
        );
        console.log('❌ Turno cancelado.');
        return;
      }

      console.log('👉 ¿Confirmás o querés cancelar tu turno?');
      return;
    }
  } catch {}

  /* 🔐 PRIVACIDAD */
  if (msg.includes('quien') || msg.includes('alguien')) {
    console.log('❌ No puedo dar información sobre otros clientes.');
    return;
  }

  /* 📍 UBICACIÓN */
  if (msg.includes('ubicacion') || msg.includes('donde queda')) {
    console.log('📍 https://www.google.com/maps/search/ZZETA%20BARBER%20CLUB/');
    return;
  }

  /* 👤 BARBERO */
  if (!contexto.barbero) {
    if (msg.includes('gonza')) {
      contexto.barbero = 'gonza';
      contexto.modoAtencion = 'turno';
      console.log('✂️ Perfecto, con Gonza es con turno.');
      console.log('¿Qué servicio querés?');
      return;
    }

    if (msg.includes('otro') || msg.includes('secundario')) {
      contexto.barbero = 'secundario';
      console.log('✂️ Con el barbero secundario puede ser por llegada o con turno.');
      console.log('¿Preferís llegar o agendar un turno?');
      return;
    }

    console.log('👤 ¿Con qué barbero querés atenderte? (Gonza / Otro)');
    return;
  }

  /* 🚶 MODO ATENCIÓN */
  if (contexto.barbero === 'secundario' && !contexto.modoAtencion) {
    if (msg.includes('llegada')) {
      contexto.modoAtencion = 'llegada';
      console.log('👌 Perfecto, te atendemos por orden de llegada.');
      return;
    }
    if (msg.includes('turno')) {
      contexto.modoAtencion = 'turno';
      console.log('👌 Genial, vamos con turno.');
      console.log('¿Qué servicio querés?');
      return;
    }
    console.log('¿Preferís por llegada o con turno?');
    return;
  }

  /* 📆 FECHA */
  const fecha = detectarFecha(msg);
  if (fecha) contexto.fecha = fecha;

  /* 💈 SERVICIO */
  const servicio = detectarServicio(msg);
  if (servicio) contexto.servicio = servicio;

  /* 🕒 HORA */
  const hora = detectarHora(msg);
  if (hora) {
    contexto.hora = hora;
    memoriaSesion.ultimaHora = hora;
  }

  /* 🔄 CAMBIO */
  if (esCambio(msg)) {
    contexto.hora = null;
    contexto.esperandoConfirmacion = false;
    console.log('👌 Dale, cambiamos. Decime otro horario.');
    await mostrarDisponibles();
    return;
  }

  /* 🧠 ARMADO */
  if (
    contexto.modoAtencion === 'turno' &&
    contexto.servicio &&
    contexto.hora &&
    !contexto.esperandoConfirmacion
  ) {
    contexto.esperandoConfirmacion = true;
    console.log(`👤 Barbero: ${contexto.barbero}`);
    console.log(`💈 ${contexto.servicio}`);
    console.log(`🕒 ${contexto.hora}`);
    console.log('👉 ¿Confirmamos?');
    return;
  }

  /* ✅ CONFIRMAR */
  if (contexto.esperandoConfirmacion && esAfirmacion(msg)) {
    await crearTurno();
    return;
  }

  /* ❌ CANCELAR */
  if (ultimoTurnoConfirmado && esCancelacion(msg)) {
    await axios.delete(`${API}/turnos/${ultimoTurnoConfirmado.id}`);
    ultimoTurnoConfirmado = null;
    console.log('❌ Turno cancelado.');
    await mostrarDisponibles();
    return;
  }

  /* 📅 HORARIOS */
  if (msg.includes('horario') || msg.includes('turnos')) {
    await mostrarDisponibles();
    return;
  }

  /* CONFIRMACIÓN PASIVA */
  if (memoriaSesion.huboConfirmacion && esAfirmacion(msg)) {
    console.log('🙌 Todo ok, tu turno sigue confirmado.');
    return;
  }

  /* DEFAULT */
  console.log('🤖 Puedo ayudarte con:');
  console.log('• elegir barbero');
  console.log('• agendar un turno');
  console.log('• horarios disponibles');
  console.log('• ubicación');
}

/* ======================================================
   INICIO
   ====================================================== */

console.log('🤖 Bot activo. Escribí un mensaje:\n');
rl.prompt();

rl.on('line', async (line) => {
  await procesarMensaje(line);
  rl.prompt();
});
