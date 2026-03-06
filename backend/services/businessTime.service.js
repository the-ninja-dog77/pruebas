const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Asuncion';

function parseIsoDate(fecha) {
  const match = String(fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseHourMinute(hora) {
  const match = String(hora || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function toUtcMinuteIndex(fecha, hora) {
  const date = parseIsoDate(fecha);
  const time = parseHourMinute(hora);
  if (!date || !time) return null;
  const ms = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 60000);
}

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

function isTooSoonDateTime(fecha, hora, horaToMinutos, minLeadMinutes = 0) {
  const lead = Number(minLeadMinutes || 0);
  if (!lead) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;
  if (!/^\d{2}:\d{2}$/.test(String(hora || ''))) return false;

  const now = getNowParts();
  if (fecha !== now.fecha) return false;

  const nowMin = horaToMinutos(now.hora);
  const targetMin = horaToMinutos(hora);
  return targetMin < nowMin + lead;
}

function keepCurrentAndFutureSlots(fecha, slots, horaToMinutos, minLeadMinutes = 0) {
  const list = Array.isArray(slots) ? slots : [];
  const now = getNowParts();

  if (fecha !== now.fecha) {
    return list;
  }

  const nowMin = horaToMinutos(now.hora);
  const lead = Number(minLeadMinutes || 0);
  const minAllowed = nowMin + lead;
  return list.filter(hora => horaToMinutos(hora) >= minAllowed);
}

function diffMinutes(fecha, hora, fromParts = null) {
  const reference = fromParts || getNowParts();
  const targetIndex = toUtcMinuteIndex(fecha, hora);
  const sourceIndex = toUtcMinuteIndex(reference?.fecha, reference?.hora);
  if (!Number.isFinite(targetIndex) || !Number.isFinite(sourceIndex)) return null;
  return targetIndex - sourceIndex;
}

module.exports = {
  BUSINESS_TIMEZONE,
  getNowParts,
  isPastDate,
  isPastDateTime,
  isTooSoonDateTime,
  keepCurrentAndFutureSlots,
  diffMinutes,
};
