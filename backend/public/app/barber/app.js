const API = {
  login: '/auth/login',
  summary: '/api/barber-panel/summary',
  calendar: '/api/barber-panel/calendar',
  day: fecha => `/api/barber-panel/day/${fecha}`,
  createTurno: fecha => `/api/barber-panel/day/${fecha}/turnos`,
  deleteTurno: (fecha, id) => `/api/barber-panel/day/${fecha}/turnos/${id}`,
  botStatus: '/api/barber-panel/bot-status',
};

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const todayLabel = document.getElementById('todayLabel');

const slides = document.getElementById('slides');
const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
const refreshSummaryBtn = document.getElementById('refreshSummaryBtn');

const turnosHoyValue = document.getElementById('turnosHoyValue');
const atendidosHoyValue = document.getElementById('atendidosHoyValue');
const pendientesHoyValue = document.getElementById('pendientesHoyValue');
const ingresosHoyValue = document.getElementById('ingresosHoyValue');
const nextTurnoLabel = document.getElementById('nextTurnoLabel');

const monthLabel = document.getElementById('monthLabel');
const calendarGrid = document.getElementById('calendarGrid');
const prevMonthBtn = document.getElementById('prevMonthBtn');
const nextMonthBtn = document.getElementById('nextMonthBtn');
const selectedDateLabel = document.getElementById('selectedDateLabel');
const selectedBusinessHours = document.getElementById('selectedBusinessHours');
const dayAgendaList = document.getElementById('dayAgendaList');
const dayActionFeedback = document.getElementById('dayActionFeedback');
const daySlots = document.getElementById('daySlots');
const weeklyHoursList = document.getElementById('weeklyHoursList');
const createTurnoCard = document.getElementById('createTurnoCard');
const createTurnoTimeLabel = document.getElementById('createTurnoTimeLabel');
const createTurnoForm = document.getElementById('createTurnoForm');
const createServicioInput = document.getElementById('createServicioInput');
const createPrecioInput = document.getElementById('createPrecioInput');
const createTurnoFeedback = document.getElementById('createTurnoFeedback');
const cancelCreateTurnoBtn = document.getElementById('cancelCreateTurnoBtn');

const botToggle = document.getElementById('botToggle');
const saveBotBtn = document.getElementById('saveBotBtn');
const botStateLabel = document.getElementById('botStateLabel');

let token = '';
let currentMonthDate = startOfMonth(new Date());
let selectedDate = '';
let monthCountsMap = {};
let selectedCreateHora = '';
let liveRefreshInterval = null;

function pad2(v) {
  return String(v).padStart(2, '0');
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthToken(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatLongDate(iso) {
  const date = parseIsoDate(iso);
  const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];

  return `${weekdays[date.getDay()]}, ${date.getDate()} de ${months[date.getMonth()]}`;
}

function setLoggedInState(isLoggedIn) {
  loginView.classList.toggle('hidden', isLoggedIn);
  appView.classList.toggle('hidden', !isLoggedIn);
}

async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    logout();
    throw new Error('Sesion expirada. Inicia sesion nuevamente.');
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const msg = data?.message || data?.error || `Error ${response.status}`;
    throw new Error(msg);
  }

  return data;
}

function renderTodayLabel() {
  const nowIso = isoDate(new Date());
  todayLabel.textContent = formatLongDate(nowIso);
}

function renderSummary(summary) {
  turnosHoyValue.textContent = summary.totalTurnosHoy ?? 0;
  atendidosHoyValue.textContent = summary.atendidosHoy ?? 0;
  pendientesHoyValue.textContent = summary.pendientesHoy ?? 0;
  ingresosHoyValue.textContent = Number(summary.ingresosHoy || 0).toLocaleString('es-ES');

  if (!summary.proximoTurno) {
    nextTurnoLabel.textContent = 'Sin turnos proximos';
    return;
  }

  const n = summary.proximoTurno;
  const pago = n.metodo_pago ? ` - Pago: ${n.metodo_pago}` : '';
  nextTurnoLabel.textContent = `${n.hora} - ${n.servicio} (${n.cliente})${pago}`;
}

async function loadSummary() {
  const data = await apiFetch(API.summary);
  renderSummary(data);
}

function setActiveNav(index) {
  navButtons.forEach((btn, i) => btn.classList.toggle('active', i === index));
}

function attachSlideNav() {
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.slide || 0);
      slides.scrollTo({ left: slides.clientWidth * index, behavior: 'smooth' });
      setActiveNav(index);
    });
  });

  slides.addEventListener('scroll', () => {
    const index = Math.round(slides.scrollLeft / slides.clientWidth);
    setActiveNav(index);
  });
}

function buildMonthLabel(date) {
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function buildCalendarMatrix(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells = [];

  for (let i = 0; i < startWeekday; i += 1) {
    const day = prevMonthDays - startWeekday + i + 1;
    const d = new Date(year, month - 1, day);
    cells.push({ date: isoDate(d), day, muted: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const d = new Date(year, month, day);
    cells.push({ date: isoDate(d), day, muted: false });
  }

  while (cells.length % 7 !== 0) {
    const day = cells.length - (startWeekday + daysInMonth) + 1;
    const d = new Date(year, month + 1, day);
    cells.push({ date: isoDate(d), day, muted: true });
  }

  return cells;
}

function renderCalendar() {
  monthLabel.textContent = buildMonthLabel(currentMonthDate);
  const todayIso = isoDate(new Date());
  const cells = buildCalendarMatrix(currentMonthDate);

  calendarGrid.innerHTML = '';
  cells.forEach(cell => {
    const btn = document.createElement('button');
    btn.className = `day-btn${cell.muted ? ' muted' : ''}${cell.date === selectedDate ? ' active' : ''}${cell.date === todayIso ? ' today' : ''}`;
    btn.type = 'button';
    btn.innerHTML = `<span>${cell.day}</span>`;

    const count = monthCountsMap[cell.date] || 0;
    if (count > 0) {
      const badge = document.createElement('small');
      badge.className = 'day-count';
      badge.textContent = count;
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => {
      selectedDate = cell.date;
      renderCalendar();
      loadDayDetails(selectedDate);
    });

    calendarGrid.appendChild(btn);
  });
}

function renderWeeklyHours(weeklyHours) {
  weeklyHoursList.innerHTML = '';
  weeklyHours.forEach(item => {
    const li = document.createElement('li');
    li.className = 'schedule-item';
    li.innerHTML = `<strong>${item.day}</strong><span>${item.label}</span>`;
    weeklyHoursList.appendChild(li);
  });
}

function setDayActionFeedback(text, kind = '') {
  dayActionFeedback.textContent = text || '';
  dayActionFeedback.className = `day-feedback${kind ? ` ${kind}` : ''}`;
}

async function loadCalendar() {
  const month = monthToken(currentMonthDate);
  const data = await apiFetch(`${API.calendar}?month=${month}`);
  monthCountsMap = {};
  (data.counts || []).forEach(c => {
    monthCountsMap[c.fecha] = Number(c.cantidad || 0);
  });
  renderWeeklyHours(data.weeklyHours || []);

  if (!selectedDate.startsWith(month)) {
    selectedDate = `${month}-01`;
  }

  renderCalendar();
  await loadDayDetails(selectedDate);
}

function renderDayDetails(data) {
  selectedDateLabel.textContent = `${formatLongDate(data.fecha)} (${data.fecha})`;
  selectedBusinessHours.textContent = `Horario: ${data.businessHours}`;
  setDayActionFeedback('');

  dayAgendaList.innerHTML = '';
  if (!data.agenda || !data.agenda.length) {
    const li = document.createElement('li');
    li.textContent = 'Sin turnos reservados';
    dayAgendaList.appendChild(li);
  } else {
    data.agenda.forEach(t => {
      const li = document.createElement('li');
      li.className = 'agenda-item';
      const details = document.createElement('span');
      const origen = t.origen ? ` [${t.origen}]` : '';
      const pago = t.metodo_pago ? ` - Pago: ${t.metodo_pago}` : '';
      details.textContent = `${t.hora} - ${t.servicio} (${t.cliente})${pago}${origen}`;

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'agenda-delete-btn';
      deleteBtn.textContent = 'Borrar';
      deleteBtn.addEventListener('click', async () => {
        const ok = window.confirm(
          `Eliminar turno de ${t.cliente} (${t.fecha} ${t.hora})?`
        );
        if (!ok) return;

        try {
          await apiFetch(API.deleteTurno(selectedDate, t.id), { method: 'DELETE' });
          setDayActionFeedback('Turno eliminado.', 'ok');
          await Promise.all([loadSummary(), loadCalendar()]);
        } catch (err) {
          setDayActionFeedback(err.message || 'No se pudo eliminar el turno.', 'error');
        }
      });

      li.appendChild(details);
      li.appendChild(deleteBtn);
      dayAgendaList.appendChild(li);
    });
  }

  daySlots.innerHTML = '';
  if (!data.disponibles || !data.disponibles.length) {
    const span = document.createElement('span');
    span.className = 'slot';
    span.textContent = 'Sin disponibilidad';
    daySlots.appendChild(span);
  } else {
    data.disponibles.forEach(h => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot slot-btn';
      btn.textContent = h;
      btn.addEventListener('click', () => {
        openCreateTurno(h);
      });
      daySlots.appendChild(btn);
    });
  }

  hideCreateTurno();
}

async function loadDayDetails(fecha) {
  const data = await apiFetch(API.day(fecha));
  renderDayDetails(data);
}

function setCreateFeedback(text, kind = '') {
  createTurnoFeedback.textContent = text || '';
  createTurnoFeedback.className = `create-feedback${kind ? ` ${kind}` : ''}`;
}

function hideCreateTurno() {
  selectedCreateHora = '';
  createTurnoCard.classList.add('hidden');
  createTurnoForm.reset();
  setCreateFeedback('');
}

function openCreateTurno(hora) {
  selectedCreateHora = hora;
  createTurnoCard.classList.remove('hidden');
  createTurnoTimeLabel.textContent = `Nuevo turno para ${selectedDate} a las ${hora}`;
  setCreateFeedback('');
  createServicioInput.focus();
}

async function submitCreateTurno(event) {
  event.preventDefault();
  setCreateFeedback('');

  if (!selectedDate || !selectedCreateHora) {
    setCreateFeedback('Selecciona una fecha y un horario.', 'error');
    return;
  }

  const servicio = createServicioInput.value.trim();
  const precio = Number(createPrecioInput.value);

  if (!servicio) {
    setCreateFeedback('Completa el servicio.', 'error');
    return;
  }

  if (!Number.isFinite(precio) || precio < 0) {
    setCreateFeedback('Completa un precio valido.', 'error');
    return;
  }

  try {
    await apiFetch(API.createTurno(selectedDate), {
      method: 'POST',
      body: JSON.stringify({
        hora: selectedCreateHora,
        servicio,
        precio: Math.round(precio),
      }),
    });
    setCreateFeedback('Turno creado.', 'ok');
    await Promise.all([loadSummary(), loadCalendar()]);
  } catch (err) {
    setCreateFeedback(err.message || 'No se pudo crear el turno.', 'error');
  }
}

function stopLiveRefresh() {
  if (liveRefreshInterval) {
    clearInterval(liveRefreshInterval);
    liveRefreshInterval = null;
  }
}

async function refreshLiveData() {
  if (!token) return;

  try {
    await loadSummary();

    // Si el formulario de carga esta abierto, evitamos refrescar calendario
    // para no pisar la edicion en curso.
    const creatingTurno = !createTurnoCard.classList.contains('hidden');
    if (!creatingTurno) {
      await loadCalendar();
    }
  } catch (err) {
    // Evita interrumpir la UI por errores temporales de red.
  }
}

function startLiveRefresh() {
  stopLiveRefresh();
  liveRefreshInterval = setInterval(() => {
    refreshLiveData();
  }, 15000);
}

function setBotState(enabled) {
  botToggle.checked = Boolean(enabled);
  botStateLabel.className = `state-label ${enabled ? 'ok' : 'off'}`;
  botStateLabel.textContent = enabled ? 'Bot activo' : 'Bot apagado';
}

async function loadBotStatus() {
  const data = await apiFetch(API.botStatus);
  setBotState(Boolean(data.enabled));
}

async function saveBotStatus() {
  const data = await apiFetch(API.botStatus, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: botToggle.checked }),
  });
  setBotState(Boolean(data.enabled));
}

async function login(username, password) {
  const data = await apiFetch(API.login, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    headers: {},
  });
  token = data.token;
}

function logout() {
  stopLiveRefresh();
  token = '';
  setLoggedInState(false);
  loginForm.reset();
}

async function bootstrapApp() {
  setLoggedInState(true);
  renderTodayLabel();
  await Promise.all([loadSummary(), loadCalendar(), loadBotStatus()]);
  startLiveRefresh();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    await login(usernameInput.value.trim(), passwordInput.value.trim());
    await bootstrapApp();
  } catch (err) {
    loginError.textContent = err.message || 'No se pudo iniciar sesion';
  }
});

logoutBtn.addEventListener('click', logout);
refreshSummaryBtn.addEventListener('click', loadSummary);
prevMonthBtn.addEventListener('click', async () => {
  currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1);
  await loadCalendar();
});
nextMonthBtn.addEventListener('click', async () => {
  currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1);
  await loadCalendar();
});
saveBotBtn.addEventListener('click', saveBotStatus);
botToggle.addEventListener('change', () => {
  setBotState(botToggle.checked);
});
createTurnoForm.addEventListener('submit', submitCreateTurno);
cancelCreateTurnoBtn.addEventListener('click', hideCreateTurno);

attachSlideNav();
renderTodayLabel();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshLiveData();
  }
});
