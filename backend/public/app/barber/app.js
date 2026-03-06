const API = {
  login: '/auth/login',
  summary: '/api/barber-panel/summary',
  calendar: '/api/barber-panel/calendar',
  day: fecha => `/api/barber-panel/day/${fecha}`,
  createTurno: fecha => `/api/barber-panel/day/${fecha}/turnos`,
  deleteTurno: (fecha, id) => `/api/barber-panel/day/${fecha}/turnos/${id}`,
  completeTurno: id => `/api/barber-panel/turnos/${id}/complete`,
  balance: range => `/api/barber-panel/balance?range=${encodeURIComponent(range)}`,
  balanceGoal: '/api/barber-panel/balance-goal',
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
const enableNotificationsBtn = document.getElementById('enableNotificationsBtn');
const notificationStatusLabel = document.getElementById('notificationStatusLabel');
const toastStack = document.getElementById('toastStack');
const completionModal = document.getElementById('completionModal');
const completionModalText = document.getElementById('completionModalText');
const completionYesBtn = document.getElementById('completionYesBtn');
const completionNoBtn = document.getElementById('completionNoBtn');
const balanceWeekBtn = document.getElementById('balanceWeekBtn');
const balanceMonthBtn = document.getElementById('balanceMonthBtn');
const balanceAmountValue = document.getElementById('balanceAmountValue');
const balanceProgressValue = document.getElementById('balanceProgressValue');
const balanceConfirmedValue = document.getElementById('balanceConfirmedValue');
const balanceGoalValue = document.getElementById('balanceGoalValue');
const balanceGoalForm = document.getElementById('balanceGoalForm');
const balanceGoalInput = document.getElementById('balanceGoalInput');
const balanceFeedback = document.getElementById('balanceFeedback');
const moneyBallFill = document.getElementById('moneyBallFill');

let token = '';
let currentMonthDate = startOfMonth(new Date());
let selectedDate = '';
let monthCountsMap = {};
let selectedCreateHora = '';
let liveRefreshInterval = null;
let localMutationSuppressUntil = 0;
let summarySnapshot = null;
let currentBalanceRange = 'week';
let pendingCompletionPrompt = null;
let dismissedCompletionByTurnoId = new Map();
let slideAnimationFrame = null;
let slideSnapDebounce = null;
let slideIsProgrammatic = false;
const animatedNumberState = new WeakMap();

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

function pushToast(message, kind = 'info') {
  if (!toastStack || !message) return;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 6000);
}

function supportsBrowserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function getNotificationPermission() {
  if (!supportsBrowserNotifications()) return 'unsupported';
  return Notification.permission;
}

function renderNotificationStatus() {
  const permission = getNotificationPermission();
  if (permission === 'granted') {
    notificationStatusLabel.className = 'state-label ok';
    notificationStatusLabel.textContent = 'Notificaciones activas';
    return;
  }

  if (permission === 'denied') {
    notificationStatusLabel.className = 'state-label off';
    notificationStatusLabel.textContent =
      'Notificaciones bloqueadas en el navegador';
    return;
  }

  notificationStatusLabel.className = 'state-label info';
  notificationStatusLabel.textContent = 'Notificaciones pendientes de activar';
}

async function requestNotificationsPermission() {
  if (!supportsBrowserNotifications()) {
    pushToast('Este navegador no soporta notificaciones.', 'info');
    renderNotificationStatus();
    return;
  }

  const permission = await Notification.requestPermission();
  renderNotificationStatus();
  if (permission === 'granted') {
    pushToast('Notificaciones activadas.', 'ok');
  } else {
    pushToast('No se pudo activar notificaciones.', 'info');
  }
}

function notifyBrowser(title, body) {
  if (!supportsBrowserNotifications()) return;
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(title, { body, tag: 'zzeta-barber-notify' });
  } catch (_) {
    // Ignora errores del navegador para no romper la UI.
  }
}

function markLocalMutation() {
  localMutationSuppressUntil = Date.now() + 10000;
}

function shouldSuppressRealtimeNotification() {
  return Date.now() < localMutationSuppressUntil;
}

function buildSummarySnapshot(summary) {
  const next = summary?.proximoTurno || null;
  const nextKey = next
    ? `${next.fecha || ''}|${next.hora || ''}|${next.cliente || ''}|${next.servicio || ''}`
    : '';

  return {
    totalTurnosHoy: Number(summary?.totalTurnosHoy || 0),
    pendientesHoy: Number(summary?.pendientesHoy || 0),
    nextKey,
  };
}

function maybeNotifySummaryChanges(summary) {
  const current = buildSummarySnapshot(summary);
  if (!summarySnapshot) {
    summarySnapshot = current;
    return;
  }

  if (shouldSuppressRealtimeNotification()) {
    summarySnapshot = current;
    return;
  }

  const deltaTurnos = current.totalTurnosHoy - summarySnapshot.totalTurnosHoy;
  if (deltaTurnos > 0) {
    const text =
      deltaTurnos === 1
        ? 'Entro 1 turno nuevo.'
        : `Entraron ${deltaTurnos} turnos nuevos.`;
    pushToast(text, 'ok');
    notifyBrowser('ZZETA Barber', text);
  }

  summarySnapshot = current;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('es-ES');
}

function easeInOutCubic(t) {
  if (t < 0.5) return 4 * t * t * t;
  return 1 - (Math.pow(-2 * t + 2, 3) / 2);
}

function parseDisplayedNumber(value) {
  const raw = String(value || '').replace(/[^0-9.-]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function animateNumberText(element, targetValue, options = {}) {
  if (!element) return;
  const target = Number(targetValue || 0);
  const formatter = options.formatter || (n => String(Math.round(n)));
  const duration = Number(options.duration || 420);

  if (!Number.isFinite(target)) {
    element.textContent = formatter(0);
    return;
  }

  const running = animatedNumberState.get(element);
  if (running?.frame) {
    cancelAnimationFrame(running.frame);
  }

  const startValue = parseDisplayedNumber(element.textContent);
  if (startValue === target || duration <= 0) {
    element.textContent = formatter(target);
    return;
  }

  const startedAt = performance.now();
  const tick = now => {
    const elapsed = now - startedAt;
    const ratio = Math.min(1, elapsed / duration);
    const eased = easeInOutCubic(ratio);
    const current = startValue + (target - startValue) * eased;
    element.textContent = formatter(current);

    if (ratio < 1) {
      const frame = requestAnimationFrame(tick);
      animatedNumberState.set(element, { frame });
    } else {
      element.textContent = formatter(target);
      animatedNumberState.delete(element);
    }
  };

  const frame = requestAnimationFrame(tick);
  animatedNumberState.set(element, { frame });
}

function setBalanceFeedback(text, kind = '') {
  if (!balanceFeedback) return;
  balanceFeedback.textContent = text || '';
  balanceFeedback.className = `create-feedback${kind ? ` ${kind}` : ''}`;
}

function setBalanceRangeButtons() {
  if (!balanceWeekBtn || !balanceMonthBtn) return;
  balanceWeekBtn.classList.toggle('active', currentBalanceRange === 'week');
  balanceMonthBtn.classList.toggle('active', currentBalanceRange === 'month');
}

function renderBalance(data) {
  if (!data) return;
  const amount = Number(data.amount || 0);
  const goal = Number(data.goal || 0);
  const confirmed = Number(data.confirmedTurnos || 0);

  animateNumberText(balanceAmountValue, amount, {
    formatter: value => formatCurrency(Math.round(value)),
    duration: 560,
  });
  balanceProgressValue.textContent = `${Number(data.progressPercent || 0).toFixed(1)}%`;
  animateNumberText(balanceConfirmedValue, confirmed, {
    formatter: value => Math.round(value).toLocaleString('es-ES'),
    duration: 480,
  });
  animateNumberText(balanceGoalValue, goal, {
    formatter: value => formatCurrency(Math.round(value)),
    duration: 480,
  });

  if (document.activeElement !== balanceGoalInput) {
    balanceGoalInput.value = goal || '';
  }

  const progress = Math.max(0, Math.min(100, Number(data.progressPercent || 0)));
  moneyBallFill.style.transform = `translateY(${(100 - progress).toFixed(2)}%)`;
  setBalanceRangeButtons();
}

async function loadBalance(range = currentBalanceRange) {
  currentBalanceRange = range;
  const data = await apiFetch(API.balance(range));
  renderBalance(data);
  return data;
}

async function saveBalanceGoal(event) {
  event.preventDefault();
  setBalanceFeedback('');
  const amount = Number(balanceGoalInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    setBalanceFeedback('Ingresa una meta valida.', 'error');
    return;
  }

  await apiFetch(API.balanceGoal, {
    method: 'PATCH',
    body: JSON.stringify({ amount: Math.round(amount) }),
  });
  setBalanceFeedback('Meta actualizada.', 'ok');
  await loadBalance(currentBalanceRange);
}

function cleanupDismissedCompletion() {
  const now = Date.now();
  for (const [id, until] of dismissedCompletionByTurnoId.entries()) {
    if (!Number.isFinite(until) || until <= now) {
      dismissedCompletionByTurnoId.delete(id);
    }
  }
}

function hideCompletionModal() {
  if (!completionModal) return;
  completionModal.classList.add('hidden');
  completionModal.setAttribute('aria-hidden', 'true');
  pendingCompletionPrompt = null;
}

function showCompletionModal(prompt) {
  if (!completionModal || !prompt) return;
  pendingCompletionPrompt = prompt;
  completionModalText.textContent = `Faltan ${prompt.minutesToNext} min para el siguiente turno. Terminaste ${prompt.servicio} de ${prompt.cliente} (${prompt.hora})?`;
  completionModal.classList.remove('hidden');
  completionModal.setAttribute('aria-hidden', 'false');
}

function maybeShowCompletionPrompt(summary) {
  cleanupDismissedCompletion();
  const prompt = summary?.completionPrompt || null;
  if (!prompt || !prompt.turnoId) {
    hideCompletionModal();
    return;
  }

  if (shouldSuppressRealtimeNotification()) return;
  const dismissedUntil = dismissedCompletionByTurnoId.get(prompt.turnoId) || 0;
  if (dismissedUntil > Date.now()) return;

  showCompletionModal(prompt);
}

async function handleCompletionYes() {
  if (!pendingCompletionPrompt?.turnoId) return;
  markLocalMutation();
  await apiFetch(API.completeTurno(pendingCompletionPrompt.turnoId), { method: 'POST' });
  pushToast('Servicio confirmado y balance actualizado.', 'ok');
  hideCompletionModal();
  await Promise.all([loadSummary(), loadCalendar(), loadBalance(currentBalanceRange)]);
}

function handleCompletionNo() {
  if (pendingCompletionPrompt?.turnoId) {
    dismissedCompletionByTurnoId.set(pendingCompletionPrompt.turnoId, Date.now() + 5 * 60 * 1000);
  }
  hideCompletionModal();
}

function setLoggedInState(isLoggedIn) {
  loginView.classList.toggle('hidden', isLoggedIn);
  appView.classList.toggle('hidden', !isLoggedIn);
}

async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  let requestUrl = url;
  if (method === 'GET') {
    const sep = requestUrl.includes('?') ? '&' : '?';
    requestUrl = `${requestUrl}${sep}_t=${Date.now()}`;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, max-age=0',
    Pragma: 'no-cache',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response = await fetch(requestUrl, { ...options, headers, cache: 'no-store' });
  if (response.status === 304) {
    const sep = requestUrl.includes('?') ? '&' : '?';
    const revalidateUrl = `${requestUrl}${sep}revalidate=${Date.now()}`;
    response = await fetch(revalidateUrl, { ...options, headers, cache: 'no-store' });
  }

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
  animateNumberText(turnosHoyValue, Number(summary.totalTurnosHoy ?? 0), {
    formatter: value => Math.round(value).toLocaleString('es-ES'),
    duration: 380,
  });
  animateNumberText(atendidosHoyValue, Number(summary.atendidosHoy ?? 0), {
    formatter: value => Math.round(value).toLocaleString('es-ES'),
    duration: 380,
  });
  animateNumberText(pendientesHoyValue, Number(summary.pendientesHoy ?? 0), {
    formatter: value => Math.round(value).toLocaleString('es-ES'),
    duration: 380,
  });
  animateNumberText(ingresosHoyValue, Number(summary.ingresosHoy || 0), {
    formatter: value => Math.round(value).toLocaleString('es-ES'),
    duration: 420,
  });

  if (!summary.proximoTurno) {
    nextTurnoLabel.textContent = 'Sin turnos proximos';
    return;
  }

  const n = summary.proximoTurno;
  const pago = n.metodo_pago ? ` - Pago: ${n.metodo_pago}` : '';
  nextTurnoLabel.textContent = `${n.hora} - ${n.servicio} (${n.cliente})${pago}`;
}

async function loadSummary(options = {}) {
  const { silentNotification = false } = options;
  const data = await apiFetch(API.summary);
  renderSummary(data);
  if (!silentNotification) {
    maybeNotifySummaryChanges(data);
    maybeShowCompletionPrompt(data);
  } else {
    summarySnapshot = buildSummarySnapshot(data);
  }
  return data;
}

function setActiveNav(index) {
  navButtons.forEach((btn, i) => btn.classList.toggle('active', i === index));
}

function getCurrentSlideIndex() {
  if (!slides || !slides.clientWidth) return 0;
  return Math.max(0, Math.round(slides.scrollLeft / slides.clientWidth));
}

function smoothSlideTo(index, duration = 560) {
  if (!slides) return;
  const targetIndex = Math.max(0, Math.min(navButtons.length - 1, Number(index || 0)));
  const targetLeft = slides.clientWidth * targetIndex;

  if (slideAnimationFrame) {
    cancelAnimationFrame(slideAnimationFrame);
    slideAnimationFrame = null;
  }

  if (duration <= 0) {
    slideIsProgrammatic = false;
    slides.scrollLeft = targetLeft;
    setActiveNav(targetIndex);
    return;
  }

  const startLeft = slides.scrollLeft;
  const distance = targetLeft - startLeft;
  if (Math.abs(distance) < 1) {
    setActiveNav(targetIndex);
    return;
  }

  slideIsProgrammatic = true;
  const startedAt = performance.now();

  const tick = now => {
    const elapsed = now - startedAt;
    const ratio = Math.min(1, elapsed / duration);
    const eased = easeInOutCubic(ratio);
    slides.scrollLeft = startLeft + distance * eased;

    if (ratio < 1) {
      slideAnimationFrame = requestAnimationFrame(tick);
      return;
    }

    slideAnimationFrame = null;
    slideIsProgrammatic = false;
    setActiveNav(targetIndex);
  };

  slideAnimationFrame = requestAnimationFrame(tick);
}

function scheduleSlideSnap() {
  if (slideSnapDebounce) clearTimeout(slideSnapDebounce);
  slideSnapDebounce = setTimeout(() => {
    if (slideIsProgrammatic) return;
    smoothSlideTo(getCurrentSlideIndex(), 620);
  }, 120);
}

function attachSlideNav() {
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.slide || 0);
      smoothSlideTo(index, 620);
    });
  });

  slides.addEventListener('scroll', () => {
    const index = getCurrentSlideIndex();
    setActiveNav(index);
    scheduleSlideSnap();
  });

  slides.addEventListener('touchstart', () => {
    if (slideAnimationFrame) {
      cancelAnimationFrame(slideAnimationFrame);
      slideAnimationFrame = null;
      slideIsProgrammatic = false;
    }
  }, { passive: true });

  slides.addEventListener('mousedown', () => {
    if (slideAnimationFrame) {
      cancelAnimationFrame(slideAnimationFrame);
      slideAnimationFrame = null;
      slideIsProgrammatic = false;
    }
  });

  window.addEventListener('resize', () => {
    smoothSlideTo(getCurrentSlideIndex(), 0);
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
      const estado = Number(t.completado || 0) === 1 ? ' [Completado]' : '';
      details.textContent = `${t.hora} - ${t.servicio} (${t.cliente})${pago}${origen}${estado}`;

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
          markLocalMutation();
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
    markLocalMutation();
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
    await loadBalance(currentBalanceRange);

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
  summarySnapshot = null;
  setLoggedInState(false);
  loginForm.reset();
}

async function bootstrapApp() {
  setLoggedInState(true);
  renderTodayLabel();
  renderNotificationStatus();
  await Promise.all([
    loadSummary({ silentNotification: true }),
    loadCalendar(),
    loadBalance(currentBalanceRange),
    loadBotStatus(),
  ]);
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
refreshSummaryBtn.addEventListener('click', async () => {
  await Promise.all([loadSummary(), loadBalance(currentBalanceRange)]);
});
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
enableNotificationsBtn.addEventListener('click', requestNotificationsPermission);
balanceWeekBtn.addEventListener('click', () => loadBalance('week'));
balanceMonthBtn.addEventListener('click', () => loadBalance('month'));
balanceGoalForm.addEventListener('submit', saveBalanceGoal);
completionYesBtn.addEventListener('click', handleCompletionYes);
completionNoBtn.addEventListener('click', handleCompletionNo);
completionModal.addEventListener('click', event => {
  if (event.target === completionModal) {
    handleCompletionNo();
  }
});
createTurnoForm.addEventListener('submit', submitCreateTurno);
cancelCreateTurnoBtn.addEventListener('click', hideCreateTurno);

attachSlideNav();
renderTodayLabel();
renderNotificationStatus();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshLiveData();
  }
});
