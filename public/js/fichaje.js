const DEPARTMENT_LABELS = { sams: 'SAMS', safd: 'SAFD' };

const clockStatusEl = document.getElementById('clock-status');
const clockSinceEl = document.getElementById('clock-since');
const clockBtn = document.getElementById('clock-btn');
const clockMessage = document.getElementById('clock-message');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'ok') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 2600);
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(startIso, endIso) {
  const start = new Date(startIso.replace(' ', 'T') + 'Z');
  const end = endIso ? new Date(endIso.replace(' ', 'T') + 'Z') : new Date();
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function checkSession() {
  const res = await fetch('/api/employee/session');
  const data = await res.json();
  if (!data.authenticated) {
    window.location.href = '/fichar.html';
    return;
  }
  document.getElementById('whoami').textContent = data.fullName;
  document.getElementById('whoami-avatar').textContent = data.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  document.getElementById('whoami-scope').textContent = DEPARTMENT_LABELS[data.department] || data.department;
}

async function loadStatus() {
  const res = await fetch('/api/employee/attendance/status');
  if (res.status === 401) { window.location.href = '/fichar.html'; return; }
  const data = await res.json();
  renderStatus(data);
}

function renderStatus(data) {
  if (data.clockedIn) {
    clockStatusEl.textContent = 'Fichado — turno en curso';
    clockStatusEl.className = 'clock-status is-in';
    clockSinceEl.textContent = `Desde las ${formatDateTime(data.since)}`;
    clockBtn.textContent = 'Fichar salida';
    clockBtn.className = 'btn-danger clock-btn';
  } else {
    clockStatusEl.textContent = 'No fichado';
    clockStatusEl.className = 'clock-status is-out';
    clockSinceEl.textContent = '';
    clockBtn.textContent = 'Fichar entrada';
    clockBtn.className = 'btn-primary clock-btn';
  }
  clockBtn.disabled = false;
}

async function loadHistory() {
  const res = await fetch('/api/employee/attendance/history');
  if (!res.ok) return;
  const rows = await res.json();
  renderHistory(rows);
}

function renderHistory(rows) {
  if (rows.length === 0) {
    historyList.innerHTML = '';
    historyEmpty.style.display = 'block';
    return;
  }
  historyEmpty.style.display = 'none';
  historyList.innerHTML = rows.map((r) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${formatDateTime(r.clock_in)}</span>
        <span class="muted-link">→ ${r.clock_out ? formatDateTime(r.clock_out) : 'en curso'}</span>
      </div>
      <span class="status-pill ${r.clock_out ? 'status-aprobado' : 'status-pendiente'}">${formatDuration(r.clock_in, r.clock_out)}</span>
    </div>
  `).join('');
}

clockBtn.addEventListener('click', async () => {
  clockBtn.disabled = true;
  clockMessage.className = 'message';
  clockMessage.textContent = '';
  try {
    const res = await fetch('/api/employee/attendance/clock', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo registrar el fichaje');

    showToast(data.clockedIn ? 'Entrada registrada.' : 'Salida registrada.');
    await loadStatus();
    await loadHistory();
  } catch (err) {
    clockMessage.className = 'message error';
    clockMessage.textContent = err.message;
    clockBtn.disabled = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Cerrando...';
  await fetch('/api/employee/logout', { method: 'POST' });
  window.location.href = '/fichar.html';
});

checkSession().then(() => {
  loadStatus();
  loadHistory();
});
