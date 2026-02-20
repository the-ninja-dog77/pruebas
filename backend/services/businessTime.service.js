const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Asuncion';

function getNowParts() {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    const map = {};
    for (const part of formatter.formatToParts(new Date())) {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    }

    return {
      fecha: `${map.year}-${map.month}-${map.day}`,
      hora: `${map.hour}:${map.minute}`,
      timezone: BUSINESS_TIMEZONE,
    };
  } catch (_err) {
    const now = new Date();
    const pad2 = value => String(value).padStart(2, '0');
    return {
      fecha: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      hora: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
      timezone: 'system-local',
    };
  }
}

function isPastDate(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;
  const now = getNowParts();
  return fecha < now.fecha;
}

function isPastDateTime(fecha, hora, horaToMinutos) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;
  if (!/^\d{2}:\d{2}$/.test(String(hora || ''))) return false;

  const now = getNowParts();
  if (fecha < now.fecha) return true;
  if (fecha > now.fecha) return false;

  return horaToMinutos(hora) < horaToMinutos(now.hora);
}

function keepCurrentAndFutureSlots(fecha, slots, horaToMinutos) {
  const list = Array.isArray(slots) ? slots : [];
  const now = getNowParts();

  if (fecha !== now.fecha) {
    return list;
  }

  const nowMin = horaToMinutos(now.hora);
  return list.filter(hora => horaToMinutos(hora) >= nowMin);
}

module.exports = {
  BUSINESS_TIMEZONE,
  getNowParts,
  isPastDate,
  isPastDateTime,
  keepCurrentAndFutureSlots,
};
