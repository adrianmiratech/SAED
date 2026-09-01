let applications = [];
let currentStatusFilter = '';
let currentDepartmentFilter = '';
let currentId = null;

const DEPARTMENT_LABELS = { sams: 'SAMS', bomberos: 'Bomberos' };

const tableBody = document.getElementById('table-body');
const emptyEl = document.getElementById('empty');
const modalBackdrop = document.getElementById('modal-backdrop');
const whoamiEl = document.getElementById('whoami');

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.authenticated) {
    window.location.href = '/login.html';
    return;
  }
  whoamiEl.textContent = data.username;
}

async function loadApplications() {
  const params = new URLSearchParams();
  if (currentStatusFilter) params.set('status', currentStatusFilter);
  if (currentDepartmentFilter) params.set('department', currentDepartmentFilter);
  const query = params.toString();
  const res = await fetch(query ? `/api/applications?${query}` : '/api/applications');
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  applications = await res.json();
  renderTable();
}

function renderTable() {
  tableBody.innerHTML = '';
  if (applications.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  for (const a of applications) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.innerHTML = `
      <td>${formatDate(a.created_at)}</td>
      <td><span class="dept-badge dept-${a.department}">${departmentLabel(a.department)}</span></td>
      <td>${escapeHtml(a.full_name)}</td>
      <td>${a.age}</td>
      <td>${escapeHtml(a.country)}</td>
      <td>${escapeHtml(a.phone)}</td>
      <td><span class="status-pill status-${a.status}">${capitalize(a.status)}</span></td>
    `;
    tr.addEventListener('click', () => openModal(a.id));
    tableBody.appendChild(tr);
  }
}

function openModal(id) {
  const a = applications.find((x) => x.id === id);
  if (!a) return;
  currentId = id;

  document.getElementById('modal-name').textContent = a.full_name;
  document.getElementById('modal-date').textContent = `Enviado el ${formatDate(a.created_at)}`;
  document.getElementById('modal-department').innerHTML = `<span class="dept-badge dept-${a.department}">${departmentLabel(a.department)}</span>`;
  document.getElementById('modal-age').textContent = a.age;
  document.getElementById('modal-country').textContent = a.country;
  document.getElementById('modal-phone').textContent = a.phone;
  document.getElementById('modal-email').textContent = a.email || 'N/A';
  document.getElementById('modal-discord').textContent = a.discord_info || 'N/A';
  document.getElementById('modal-criminal').textContent = a.criminal_record;
  document.getElementById('modal-experience').textContent = a.experience;
  document.getElementById('modal-motivation').textContent = a.motivation;
  document.getElementById('modal-notes').value = a.review_notes || '';

  const statusEl = document.getElementById('modal-status');
  statusEl.innerHTML = `<span class="status-pill status-${a.status}">${capitalize(a.status)}</span>`;

  const reviewedWrap = document.getElementById('modal-reviewed-wrap');
  if (a.reviewed_by) {
    reviewedWrap.style.display = 'block';
    document.getElementById('modal-reviewed').textContent = `${a.reviewed_by} — ${formatDate(a.reviewed_at)}`;
  } else {
    reviewedWrap.style.display = 'none';
  }

  modalBackdrop.classList.add('open');
}

function closeModal() {
  modalBackdrop.classList.remove('open');
  currentId = null;
}

async function updateStatus(status) {
  if (!currentId) return;
  const reviewNotes = document.getElementById('modal-notes').value;
  await fetch(`/api/applications/${currentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, reviewNotes }),
  });
  closeModal();
  loadApplications();
}

async function deleteApplication() {
  if (!currentId) return;
  if (!confirm('¿Eliminar esta postulación permanentemente?')) return;
  await fetch(`/api/applications/${currentId}`, { method: 'DELETE' });
  closeModal();
  loadApplications();
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function departmentLabel(department) {
  return DEPARTMENT_LABELS[department] || department;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentStatusFilter = btn.dataset.status;
    loadApplications();
  });
});

document.querySelectorAll('.dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentDepartmentFilter = btn.dataset.department;
    loadApplications();
  });
});

document.getElementById('refresh-btn').addEventListener('click', loadApplications);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-delete').addEventListener('click', deleteApplication);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => updateStatus(btn.dataset.action));
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

checkSession().then(loadApplications);
