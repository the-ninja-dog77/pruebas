const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];

const DAY_RULES = {
  0: { closed: true, label: 'Cerrado' },
  1: { open: '09:00', close: '20:00', label: '9 a.m a 8 p.m.' },
  2: { open: '09:00', close: '20:00', label: '9 a.m a 8 p.m.' },
  3: { open: '09:00', close: '20:00', label: '9 a.m a 8 p.m.' },
  4: { open: '09:00', close: '20:00', label: '9 a.m a 8 p.m.' },
  5: { open: '09:00', close: '20:00', label: '9 a.m a 8 p.m.' },
  6: { open: '09:00', close: '20:00', label: '9 a.m a 8 p.m.' },
};

const DISPLAY_ORDER = [5, 6, 0, 1, 2, 3, 4];
const SLOT_MINUTES = 60;

function horaToMinutos(hora) {
  const [h, m] = String(hora || '')
    .split(':')
    .map(Number);

  return h * 60 + m;
}

function minutosToHora(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getWeekdayFromDate(fecha) {
  if (!fecha) return null;
  const date = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getDay();
}

function getRuleForWeekday(weekday) {
  return DAY_RULES[weekday] || { closed: true, label: 'Cerrado' };
}

function getRuleForDate(fecha) {
  const weekday = getWeekdayFromDate(fecha);
  if (weekday === null) {
    return { weekday: null, dayName: '', closed: true, label: 'Fecha invalida' };
  }

  const rule = getRuleForWeekday(weekday);
  return {
    weekday,
    dayName: DAY_NAMES[weekday],
    ...rule,
  };
}

function getSlotsForDate(fecha) {
  const rule = getRuleForDate(fecha);
  if (rule.closed || !rule.open || !rule.close) return [];

  const start = horaToMinutos(rule.open);
  const end = horaToMinutos(rule.close);
  const slots = [];

  for (let min = start; min < end; min += SLOT_MINUTES) {
    slots.push(minutosToHora(min));
  }

  return slots;
}

function getWeeklyHoursDisplay() {
  return DISPLAY_ORDER.map(day => {
    const rule = getRuleForWeekday(day);
    return {
      day: DAY_NAMES[day],
      label: rule.label,
      closed: Boolean(rule.closed),
      open: rule.open || null,
      close: rule.close || null,
    };
  });
}

module.exports = {
  SLOT_MINUTES,
  DAY_NAMES,
  horaToMinutos,
  getRuleForDate,
  getSlotsForDate,
  getWeeklyHoursDisplay,
};
