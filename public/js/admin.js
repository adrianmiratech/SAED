let applications = [];
let currentStatusFilter = '';
let currentDepartmentFilter = '';
let currentSearch = '';
let currentId = null;
let scopedDepartment = null;
let currentUsername = null;

let ranks = [];
let employees = [];
let currentPersonalDeptFilter = '';
let currentPersonalSearch = '';
let currentEmployeeId = null;

const DEPARTMENT_LABELS = { sams: 'SAMS', safd: 'SAFD' };
const STATUS_LABELS = { pendiente: 'Pendiente', en_revision: 'En revisión', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const PAGE_TITLES = {
  postulaciones: ['Postulaciones', 'Revisá, filtrá y gestioná las postulaciones a SAMS y SAFD.'],
  personal: ['Personal', 'Roster de empleados, rangos y nómina del SAED.'],
  turnos: ['Turnos', 'Calendario de guardias asignadas al personal del SAED.'],
  inventario: ['Inventario', 'Stock de insumos y medicamentos de SAMS y SAFD.'],
  atenciones: ['Atenciones', 'Fichas de pacientes e informes de intervención.'],
};

const tableBody = document.getElementById('table-body');
const emptyEl = document.getElementById('empty');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalRankSelect = document.getElementById('modal-rank');
const whoamiEl = document.getElementById('whoami');
const searchInput = document.getElementById('search-input');
const toastContainer = document.getElementById('toast-container');
const deptFilterRow = document.getElementById('dept-filter-row');
const manageStaffBtn = document.getElementById('manage-staff-btn');
const staffModalBackdrop = document.getElementById('staff-modal-backdrop');
const staffList = document.getElementById('staff-list');
const staffForm = document.getElementById('staff-form');
const staffMessage = document.getElementById('staff-message');

const tabPostulaciones = document.getElementById('tab-postulaciones');
const tabPersonal = document.getElementById('tab-personal');
const personalDeptFilterRow = document.getElementById('personal-dept-filter-row');
const ratesBtn = document.getElementById('rates-btn');
const newEmployeeBtn = document.getElementById('new-employee-btn');
const employeesColumns = document.getElementById('employees-columns');
const employeesEmpty = document.getElementById('employees-empty');
const employeeModalBackdrop = document.getElementById('employee-modal-backdrop');
const employeeForm = document.getElementById('employee-form');
const employeeMessage = document.getElementById('employee-message');
const employeeDepartmentField = document.getElementById('employee-department-field');
const employeeDepartmentSelect = document.getElementById('employee-department');
const employeeRankSelect = document.getElementById('employee-rank');
const employeeActiveField = document.getElementById('employee-active-field');
const employeeActiveCheckbox = document.getElementById('employee-active');
const employeeFormSubmit = document.getElementById('employee-form-submit');
const employeeDeleteBtn = document.getElementById('employee-delete-btn');
const employeePayrollSection = document.getElementById('employee-payroll-section');
const payrollList = document.getElementById('payroll-list');
const payrollMessage = document.getElementById('payroll-message');
const ratesModalBackdrop = document.getElementById('rates-modal-backdrop');
const ratesList = document.getElementById('rates-list');

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.authenticated) {
    window.location.href = '/login.html';
    return;
  }
  scopedDepartment = data.department || null;
  currentUsername = data.username;
  whoamiEl.textContent = data.username;
  document.getElementById('whoami-avatar').textContent = initials(data.username);
  document.getElementById('whoami-scope').textContent = scopedDepartment
    ? departmentLabel(scopedDepartment)
    : 'Todos los departamentos';

  if (scopedDepartment) {
    // Staff restringido a un departamento: no tiene sentido mostrar el
    // selector, el servidor ya solo le devuelve ese departamento.
    deptFilterRow.style.display = 'none';
    currentDepartmentFilter = scopedDepartment;

    personalDeptFilterRow.style.display = 'none';
    currentPersonalDeptFilter = scopedDepartment;
    employeeDepartmentField.style.display = 'none';

    document.getElementById('shifts-dept-filter-row').style.display = 'none';
    currentShiftsDeptFilter = scopedDepartment;

    document.getElementById('inventory-dept-filter-row').style.display = 'none';
    currentInventoryDeptFilter = scopedDepartment;

    document.getElementById('cases-dept-filter-row').style.display = 'none';
    currentCasesDeptFilter = scopedDepartment;
  } else {
    // Solo el staff sin departamento asignado gestiona otras cuentas y
    // define las tarifas de pago por rango.
    manageStaffBtn.style.display = 'inline-flex';
    ratesBtn.style.display = 'inline-flex';
  }
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
  renderStats();
  renderTable();
}

function renderStats() {
  document.getElementById('stat-total').textContent = applications.length;
  document.getElementById('stat-pendiente').textContent = applications.filter((a) => a.status === 'pendiente').length;
  document.getElementById('stat-aprobado').textContent = applications.filter((a) => a.status === 'aprobado').length;
  document.getElementById('stat-rechazado').textContent = applications.filter((a) => a.status === 'rechazado').length;
}

function getFilteredApplications() {
  if (!currentSearch) return applications;
  const term = currentSearch.toLowerCase();
  return applications.filter((a) => (
    a.full_name.toLowerCase().includes(term)
    || a.country.toLowerCase().includes(term)
  ));
}

function renderTable() {
  const rows = getFilteredApplications();
  tableBody.innerHTML = '';

  if (rows.length === 0) {
    emptyEl.style.display = 'block';
    emptyEl.querySelector('p').textContent = currentSearch
      ? 'No hay postulaciones que coincidan con la búsqueda.'
      : 'No hay postulaciones en esta categoría.';
    return;
  }
  emptyEl.style.display = 'none';

  for (const a of rows) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.innerHTML = `
      <td>${formatDate(a.created_at)}</td>
      <td><span class="dept-badge dept-${a.department}">${departmentLabel(a.department)}</span></td>
      <td>${escapeHtml(a.full_name)}</td>
      <td>${a.age}</td>
      <td>${escapeHtml(a.country)}</td>
      <td><span class="status-pill status-${a.status}">${STATUS_LABELS[a.status] || capitalize(a.status)}</span></td>
      <td class="row-chevron">›</td>
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
  document.getElementById('modal-discord').textContent = a.discord_info || 'N/A';
  document.getElementById('modal-criminal').textContent = a.criminal_record;
  document.getElementById('modal-previous-saed').textContent = a.previous_saed_experience === 'Sí' && a.previous_saed_details
    ? `Sí — ${a.previous_saed_details}`
    : a.previous_saed_experience;
  document.getElementById('modal-experience').textContent = a.experience;
  document.getElementById('modal-motivation').textContent = a.motivation;
  document.getElementById('modal-notes').value = a.review_notes || '';
  populateRankSelect(a.department, null, modalRankSelect);

  document.getElementById('modal-status').innerHTML = `<span class="status-pill status-${a.status}">${STATUS_LABELS[a.status] || capitalize(a.status)}</span>`;

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

async function updateStatus(status, btn) {
  if (!currentId) return;
  const reviewNotes = document.getElementById('modal-notes').value;

  if (status === 'aprobado' && !modalRankSelect.value) {
    showToast('Elegí el rango a asignar antes de aprobar.', 'danger');
    return;
  }

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    const res = await fetch(`/api/applications/${currentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        reviewNotes,
        rankId: status === 'aprobado' ? Number(modalRankSelect.value) : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo actualizar la postulación');
    closeModal();
    await loadApplications();
    showToast(status === 'aprobado' ? 'Postulación aprobada y sumada al roster de Personal.' : 'Postulación actualizada.');
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function deleteApplication() {
  if (!currentId) return;
  if (!confirm('¿Eliminar esta postulación permanentemente?')) return;
  await fetch(`/api/applications/${currentId}`, { method: 'DELETE' });
  closeModal();
  await loadApplications();
  showToast('Postulación eliminada.', 'danger');
}

async function loadStaff() {
  const res = await fetch('/api/admins');
  if (!res.ok) return;
  const staff = await res.json();
  renderStaffList(staff);
}

function renderStaffList(staff) {
  staffList.innerHTML = '';
  if (staff.length === 0) {
    staffList.innerHTML = '<div class="staff-empty">No hay usuarios cargados.</div>';
    return;
  }
  for (const s of staff) {
    const row = document.createElement('div');
    row.className = 'staff-row';
    const deptBadge = s.department
      ? `<span class="dept-badge dept-${s.department}">${departmentLabel(s.department)}</span>`
      : '<span class="dept-badge">Todos</span>';
    row.innerHTML = `
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(s.username)}</span>
        ${deptBadge}
      </div>
      <button class="btn btn-danger btn-sm" data-delete-staff="${s.id}" ${s.username === currentUsername ? 'disabled' : ''}>Eliminar</button>
    `;
    staffList.appendChild(row);
  }

  staffList.querySelectorAll('[data-delete-staff]').forEach((btn) => {
    btn.addEventListener('click', () => deleteStaff(btn.dataset.deleteStaff));
  });
}

async function deleteStaff(id) {
  if (!confirm('¿Eliminar este usuario de staff?')) return;
  const res = await fetch(`/api/admins/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    showToast(data.error || 'No se pudo eliminar el usuario', 'danger');
    return;
  }
  showToast('Usuario eliminado.');
  loadStaff();
}

function openStaffModal() {
  staffMessage.className = 'message';
  staffMessage.textContent = '';
  staffForm.reset();
  staffModalBackdrop.classList.add('open');
  loadStaff();
}

function closeStaffModal() {
  staffModalBackdrop.classList.remove('open');
}

staffForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  staffMessage.className = 'message';
  staffMessage.textContent = '';

  const username = document.getElementById('staff-username').value.trim();
  const password = document.getElementById('staff-password').value;
  const department = document.getElementById('staff-department').value;

  const submitBtn = staffForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, department: department || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear el usuario');

    staffMessage.className = 'message success';
    staffMessage.textContent = `Usuario "${data.username}" creado.`;
    staffForm.reset();
    loadStaff();
  } catch (err) {
    staffMessage.className = 'message error';
    staffMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

manageStaffBtn.addEventListener('click', openStaffModal);
document.getElementById('staff-modal-close').addEventListener('click', closeStaffModal);
staffModalBackdrop.addEventListener('click', (e) => {
  if (e.target === staffModalBackdrop) closeStaffModal();
});

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

searchInput.addEventListener('input', () => {
  currentSearch = searchInput.value.trim();
  renderTable();
});

document.getElementById('refresh-btn').addEventListener('click', loadApplications);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-delete').addEventListener('click', deleteApplication);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modalBackdrop.classList.contains('open')) closeModal();
  if (staffModalBackdrop.classList.contains('open')) closeStaffModal();
});
document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => updateStatus(btn.dataset.action, btn));
});

document.getElementById('logout-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Cerrando...';
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---------- Menú lateral en mobile (cajón deslizante) ----------

const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

function openSidebar() {
  sidebarEl.classList.add('open');
  sidebarBackdrop.classList.add('open');
}

function closeSidebar() {
  sidebarEl.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
}

menuToggleBtn.addEventListener('click', openSidebar);
sidebarCloseBtn.addEventListener('click', closeSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebarEl.classList.contains('open')) closeSidebar();
});

document.getElementById('export-btn').addEventListener('click', () => {
  const params = new URLSearchParams();
  if (currentStatusFilter) params.set('status', currentStatusFilter);
  if (currentDepartmentFilter) params.set('department', currentDepartmentFilter);
  window.location.href = `/api/applications/export.csv?${params.toString()}`;
});

// ---------- Navegación entre módulos (sidebar) ----------

const TAB_IDS = ['postulaciones', 'personal', 'turnos', 'inventario', 'atenciones'];

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    closeSidebar();
    const tab = btn.dataset.tab;

    TAB_IDS.forEach((id) => {
      document.getElementById(`tab-${id}`).style.display = tab === id ? 'block' : 'none';
    });

    const [title, subtitle] = PAGE_TITLES[tab] || ['', ''];
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-subtitle').textContent = subtitle;

    if (tab === 'personal') {
      if (ranks.length === 0) loadRanks();
      loadEmployees();
    } else if (tab === 'turnos') {
      if (employees.length === 0) await loadEmployees();
      loadShifts();
    } else if (tab === 'inventario') {
      loadInventory();
    } else if (tab === 'atenciones') {
      if (employees.length === 0) await loadEmployees();
      loadCases();
    }
  });
});

document.getElementById('personal-search-input').addEventListener('input', (e) => {
  currentPersonalSearch = e.target.value.trim();
  renderEmployeesBoard();
});

document.querySelectorAll('.personal-dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.personal-dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentPersonalDeptFilter = btn.dataset.department;
    loadEmployees();
  });
});

async function loadRanks() {
  const res = await fetch('/api/ranks');
  if (!res.ok) return;
  ranks = await res.json();
}

function ranksForDepartment(department) {
  return ranks.filter((r) => !r.department || r.department === department);
}

function populateRankSelect(department, selectedRankId, selectEl = employeeRankSelect) {
  const list = ranksForDepartment(department);
  selectEl.innerHTML = list.map((r) => (
    `<option value="${r.id}">${r.level} — ${escapeHtml(r.name)}</option>`
  )).join('');
  if (selectedRankId) selectEl.value = selectedRankId;
}

employeeDepartmentSelect.addEventListener('change', () => {
  populateRankSelect(employeeDepartmentSelect.value);
});

const RANK_TIERS = [
  { min: 8, max: 9, label: 'Comisionado SAED', solid: '#a78bfa', soft: 'rgba(167,139,250,0.18)' },
  { min: 6, max: 7, label: 'Jefatura SAED', solid: '#6366f1', soft: 'rgba(99,102,241,0.18)' },
  { min: 4, max: 5, label: 'Rango medio', solid: '#14b8a6', soft: 'rgba(20,184,166,0.18)' },
  { min: 2, max: 3, label: 'Rango bajo', solid: '#f59e0b', soft: 'rgba(245,158,11,0.18)' },
  { min: 1, max: 1, label: 'Academia', solid: '#94a3b8', soft: 'rgba(148,163,184,0.18)' },
  { min: 0, max: 0, label: 'Voluntario', solid: '#eab308', soft: 'rgba(234,179,8,0.18)' },
];

function tierForLevel(level) {
  return RANK_TIERS.find((t) => level >= t.min && level <= t.max) || RANK_TIERS[RANK_TIERS.length - 1];
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

async function loadEmployees() {
  const params = new URLSearchParams();
  if (currentPersonalDeptFilter) params.set('department', currentPersonalDeptFilter);
  const query = params.toString();
  const res = await fetch(query ? `/api/employees?${query}` : '/api/employees');
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  employees = await res.json();
  renderEmployeesBoard();
  renderPersonalStats();
}

function renderPersonalStats() {
  document.getElementById('pstat-total').textContent = employees.length;
  document.getElementById('pstat-active').textContent = employees.filter((e) => e.active).length;
  document.getElementById('pstat-inactive').textContent = employees.filter((e) => !e.active).length;

  const params = new URLSearchParams({ paid: '0' });
  if (currentPersonalDeptFilter) params.set('department', currentPersonalDeptFilter);
  fetch(`/api/payroll?${params.toString()}`)
    .then((res) => (res.ok ? res.json() : []))
    .then((rows) => {
      const total = rows.reduce((sum, p) => sum + Number(p.total_amount), 0);
      document.getElementById('pstat-pending').textContent = rows.length
        ? `${rows.length} · $${total.toFixed(2)}`
        : '0';
    });
}

function kanbanCardHtml(e) {
  const tier = tierForLevel(e.rank_level);
  return `
    <div class="kanban-card${e.active ? '' : ' is-inactive'}" data-employee-id="${e.id}" title="${escapeHtml(e.rank_name)}">
      <span class="kanban-avatar" style="background:${tier.solid}">${escapeHtml(initials(e.full_name))}</span>
      <span class="kanban-name">${escapeHtml(e.full_name)}</span>
      <span class="dept-badge dept-${e.department} kanban-dept-badge">${departmentLabel(e.department)}</span>
      <span class="employee-status-dot${e.active ? '' : ' is-inactive'}" title="${e.active ? 'Activo' : 'Inactivo'}"></span>
    </div>
  `;
}

function rankNameForLevel(level, department) {
  const rank = ranks.find((r) => r.level === level && (r.department === department || (!r.department && !department)));
  return rank ? rank.name : null;
}

function kanbanColumnSubtitle(level) {
  if (scopedDepartment) return rankNameForLevel(level, scopedDepartment) || '';
  if (currentPersonalDeptFilter) return rankNameForLevel(level, currentPersonalDeptFilter) || '';

  const shared = rankNameForLevel(level, null);
  if (shared) return shared;
  const samsName = rankNameForLevel(level, 'sams');
  const safdName = rankNameForLevel(level, 'safd');
  return `SAMS: ${samsName || '—'} · SAFD: ${safdName || '—'}`;
}

function kanbanColumnHtml(level, list) {
  const tier = tierForLevel(level);
  const levelEmployees = list.filter((e) => e.rank_level === level);
  return `
    <div class="kanban-column">
      <div class="kanban-column-header" style="background:${tier.soft}">
        <div class="kanban-column-level" style="color:${tier.solid}">Nv. ${level}</div>
        <div class="kanban-column-tier">${tier.label}</div>
        <div class="kanban-column-subtitle">${escapeHtml(kanbanColumnSubtitle(level))}</div>
      </div>
      <div class="kanban-column-body">
        ${levelEmployees.length === 0
          ? '<div class="kanban-empty">Sin empleados</div>'
          : levelEmployees.map(kanbanCardHtml).join('')}
      </div>
    </div>
  `;
}

function getFilteredEmployees() {
  if (!currentPersonalSearch) return employees;
  const term = currentPersonalSearch.toLowerCase();
  return employees.filter((e) => (
    e.full_name.toLowerCase().includes(term)
    || (e.phone || '').toLowerCase().includes(term)
    || (e.discord_info || '').toLowerCase().includes(term)
    || e.rank_name.toLowerCase().includes(term)
  ));
}

function renderEmployeesBoard() {
  const employeesSearchEmpty = document.getElementById('employees-search-empty');

  if (employees.length === 0) {
    employeesColumns.innerHTML = '';
    employeesEmpty.style.display = 'block';
    employeesSearchEmpty.style.display = 'none';
    return;
  }
  employeesEmpty.style.display = 'none';

  const filtered = getFilteredEmployees();
  if (filtered.length === 0) {
    employeesColumns.innerHTML = '';
    employeesSearchEmpty.style.display = 'block';
    return;
  }
  employeesSearchEmpty.style.display = 'none';

  const levels = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  employeesColumns.className = 'kanban-board';
  employeesColumns.innerHTML = levels.map((level) => kanbanColumnHtml(level, filtered)).join('');

  employeesColumns.querySelectorAll('[data-employee-id]').forEach((card) => {
    card.addEventListener('click', () => openEmployeeModal(Number(card.dataset.employeeId)));
  });
}

function resetEmployeeForm() {
  employeeForm.reset();
  employeeMessage.className = 'message';
  employeeMessage.textContent = '';
  payrollMessage.className = 'message';
  payrollMessage.textContent = '';
}

function openNewEmployeeModal() {
  currentEmployeeId = null;
  resetEmployeeForm();

  document.getElementById('employee-modal-name').textContent = 'Nuevo empleado';
  document.getElementById('employee-modal-sub').textContent = 'Registrar un nuevo integrante del SAED.';
  document.getElementById('employee-modal-department').innerHTML = '';
  document.getElementById('employee-modal-active').innerHTML = '';
  employeeFormSubmit.textContent = 'Crear empleado';
  employeeDeleteBtn.style.display = 'none';
  employeeActiveField.style.display = 'none';
  employeePayrollSection.style.display = 'none';
  employeeDepartmentField.style.display = scopedDepartment ? 'none' : 'block';

  // Si hay un filtro de departamento activo, el nuevo empleado arranca en
  // ese departamento para que aparezca en la lista apenas se crea.
  const initialDept = scopedDepartment || currentPersonalDeptFilter || 'sams';
  employeeDepartmentSelect.value = initialDept;
  populateRankSelect(initialDept);

  employeeModalBackdrop.classList.add('open');
}

async function openEmployeeModal(id) {
  const e = employees.find((x) => x.id === id);
  if (!e) return;
  currentEmployeeId = id;
  resetEmployeeForm();

  document.getElementById('employee-modal-name').textContent = e.full_name;
  document.getElementById('employee-modal-sub').textContent = [
    e.phone ? `☎ ${e.phone}` : null,
    e.discord_info ? `ID de Discord: ${e.discord_info}` : null,
  ].filter(Boolean).join(' · ');
  document.getElementById('employee-modal-department').innerHTML = `<span class="dept-badge dept-${e.department}">${departmentLabel(e.department)}</span>`;
  document.getElementById('employee-modal-active').innerHTML = `<span class="status-pill ${e.active ? 'status-aprobado' : 'status-rechazado'}">${e.active ? 'Activo' : 'Inactivo'}</span>`;
  employeeFormSubmit.textContent = 'Guardar cambios';
  employeeDeleteBtn.style.display = 'inline-flex';
  employeeActiveField.style.display = 'flex';
  employeePayrollSection.style.display = 'block';
  employeeDepartmentField.style.display = 'none';

  document.getElementById('employee-fullname').value = e.full_name;
  document.getElementById('employee-phone').value = e.phone || '';
  document.getElementById('employee-discord').value = e.discord_info || '';
  employeeActiveCheckbox.checked = !!e.active;
  populateRankSelect(e.department, e.rank_id);

  employeeModalBackdrop.classList.add('open');
  await loadPayroll(id);
}

function closeEmployeeModal() {
  employeeModalBackdrop.classList.remove('open');
  currentEmployeeId = null;
}

employeeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  employeeMessage.className = 'message';
  employeeMessage.textContent = '';

  const fullName = document.getElementById('employee-fullname').value.trim();
  const phone = document.getElementById('employee-phone').value.trim();
  const discordInfo = document.getElementById('employee-discord').value.trim();
  const rankId = Number(employeeRankSelect.value);
  const department = scopedDepartment || employeeDepartmentSelect.value;

  const submitBtn = employeeFormSubmit;
  submitBtn.disabled = true;

  try {
    const isEdit = !!currentEmployeeId;
    const url = isEdit ? `/api/employees/${currentEmployeeId}` : '/api/employees';
    const method = isEdit ? 'PATCH' : 'POST';
    const body = isEdit
      ? { fullName, phone, discordInfo, rankId, active: employeeActiveCheckbox.checked }
      : { fullName, phone, discordInfo, rankId, department };

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el empleado');

    showToast(isEdit ? 'Empleado actualizado.' : 'Empleado creado.');

    if (!isEdit && !scopedDepartment && currentPersonalDeptFilter && currentPersonalDeptFilter !== department) {
      // El empleado se creó en un departamento distinto al filtro activo:
      // mostramos "Todos" para que aparezca sin que parezca que se perdió.
      currentPersonalDeptFilter = '';
      document.querySelectorAll('.personal-dept-filter-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.department === '');
      });
    }

    await loadEmployees();
    if (isEdit) {
      await openEmployeeModal(currentEmployeeId);
    } else {
      closeEmployeeModal();
    }
  } catch (err) {
    employeeMessage.className = 'message error';
    employeeMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

employeeDeleteBtn.addEventListener('click', async () => {
  if (!currentEmployeeId) return;
  if (!confirm('¿Eliminar este empleado y toda su nómina asociada?')) return;
  await fetch(`/api/employees/${currentEmployeeId}`, { method: 'DELETE' });
  closeEmployeeModal();
  await loadEmployees();
  showToast('Empleado eliminado.', 'danger');
});

async function loadPayroll(employeeId) {
  const res = await fetch(`/api/payroll?employeeId=${employeeId}`);
  if (!res.ok) return;
  const rows = await res.json();
  renderPayrollList(rows);
}

function renderPayrollList(rows) {
  payrollList.innerHTML = '';
  if (rows.length === 0) {
    payrollList.innerHTML = '<div class="staff-empty">Todavía no se registraron horas.</div>';
    return;
  }
  for (const p of rows) {
    const row = document.createElement('div');
    row.className = 'staff-row';
    row.innerHTML = `
      <div class="staff-meta">
        <span class="staff-username">${p.hours}h × $${Number(p.hourly_rate).toFixed(2)} = $${Number(p.total_amount).toFixed(2)}</span>
        ${p.period_label ? `<span class="dept-badge">${escapeHtml(p.period_label)}</span>` : ''}
        <span class="status-pill ${p.paid ? 'status-aprobado' : 'status-pendiente'}">${p.paid ? 'Pagada' : 'Pendiente'}</span>
      </div>
      <button class="btn btn-ghost btn-sm" data-toggle-paid="${p.id}" data-paid="${p.paid ? '0' : '1'}">${p.paid ? 'Marcar pendiente' : 'Marcar pagada'}</button>
      <button class="btn btn-danger btn-sm" data-delete-payroll="${p.id}">Eliminar</button>
    `;
    payrollList.appendChild(row);
  }

  payrollList.querySelectorAll('[data-toggle-paid]').forEach((btn) => {
    btn.addEventListener('click', () => togglePayrollPaid(btn.dataset.togglePaid, btn.dataset.paid === '1'));
  });
  payrollList.querySelectorAll('[data-delete-payroll]').forEach((btn) => {
    btn.addEventListener('click', () => deletePayroll(btn.dataset.deletePayroll));
  });
}

async function togglePayrollPaid(id, paid) {
  await fetch(`/api/payroll/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paid }),
  });
  await loadPayroll(currentEmployeeId);
  showToast(paid ? 'Nómina marcada como pagada.' : 'Nómina marcada como pendiente.');
}

async function deletePayroll(id) {
  if (!confirm('¿Eliminar este registro de nómina?')) return;
  await fetch(`/api/payroll/${id}`, { method: 'DELETE' });
  await loadPayroll(currentEmployeeId);
  showToast('Registro de nómina eliminado.', 'danger');
}

document.getElementById('payroll-add-btn').addEventListener('click', async () => {
  if (!currentEmployeeId) return;
  payrollMessage.className = 'message';
  payrollMessage.textContent = '';

  const hours = Number(document.getElementById('payroll-hours').value);
  const periodLabel = document.getElementById('payroll-period').value.trim();

  if (!Number.isFinite(hours) || hours <= 0) {
    payrollMessage.className = 'message error';
    payrollMessage.textContent = 'Ingresá una cantidad de horas válida.';
    return;
  }

  try {
    const res = await fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: currentEmployeeId, hours, periodLabel }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo generar la nómina');

    document.getElementById('payroll-hours').value = '';
    document.getElementById('payroll-period').value = '';
    await loadPayroll(currentEmployeeId);
    showToast('Nómina generada.');
  } catch (err) {
    payrollMessage.className = 'message error';
    payrollMessage.textContent = err.message;
  }
});

async function openRatesModal() {
  await loadRanks();
  renderRatesList();
  ratesModalBackdrop.classList.add('open');
}

function renderRatesList() {
  ratesList.innerHTML = '';
  for (const r of ranks) {
    const row = document.createElement('div');
    row.className = 'rate-row';
    row.innerHTML = `
      <span class="rate-name">${r.level} — ${escapeHtml(r.name)}${r.department ? ` (${departmentLabel(r.department)})` : ''}</span>
      <input type="number" min="0" step="0.01" value="${r.hourly_rate}" data-rank-id="${r.id}" />
    `;
    ratesList.appendChild(row);
  }

  ratesList.querySelectorAll('input[data-rank-id]').forEach((input) => {
    input.addEventListener('change', async () => {
      const rankId = input.dataset.rankId;
      const hourlyRate = Number(input.value);
      const res = await fetch(`/api/ranks/${rankId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hourlyRate }),
      });
      if (res.ok) {
        showToast('Tarifa actualizada.');
        await loadRanks();
      } else {
        showToast('No se pudo actualizar la tarifa.', 'danger');
      }
    });
  });
}

function closeRatesModal() {
  ratesModalBackdrop.classList.remove('open');
}

newEmployeeBtn.addEventListener('click', openNewEmployeeModal);
document.getElementById('employee-modal-close').addEventListener('click', closeEmployeeModal);
employeeModalBackdrop.addEventListener('click', (e) => {
  if (e.target === employeeModalBackdrop) closeEmployeeModal();
});

ratesBtn.addEventListener('click', openRatesModal);
document.getElementById('rates-modal-close').addEventListener('click', closeRatesModal);
ratesModalBackdrop.addEventListener('click', (e) => {
  if (e.target === ratesModalBackdrop) closeRatesModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (employeeModalBackdrop.classList.contains('open')) closeEmployeeModal();
  if (ratesModalBackdrop.classList.contains('open')) closeRatesModal();
  if (shiftModalBackdrop.classList.contains('open')) closeShiftModal();
  if (inventoryModalBackdrop.classList.contains('open')) closeInventoryModal();
  if (caseModalBackdrop.classList.contains('open')) closeCaseModal();
});

// ---------- Turnos ----------

let shifts = [];
let currentShiftsDeptFilter = '';
let currentShiftsSearch = '';
let currentShiftId = null;

const shiftsTableBody = document.getElementById('shifts-table-body');
const shiftsEmpty = document.getElementById('shifts-empty');
const shiftModalBackdrop = document.getElementById('shift-modal-backdrop');
const shiftForm = document.getElementById('shift-form');
const shiftMessage = document.getElementById('shift-message');
const shiftEmployeeSelect = document.getElementById('shift-employee');
const shiftFormSubmit = document.getElementById('shift-form-submit');
const shiftDeleteBtn = document.getElementById('shift-delete-btn');

async function loadShifts() {
  const params = new URLSearchParams();
  if (currentShiftsDeptFilter) params.set('department', currentShiftsDeptFilter);
  const query = params.toString();
  const res = await fetch(query ? `/api/shifts?${query}` : '/api/shifts');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  shifts = await res.json();
  renderShiftsStats();
  renderShiftsTable();
}

function renderShiftsStats() {
  document.getElementById('sstat-total').textContent = shifts.length;
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('sstat-today').textContent = shifts.filter((s) => s.shift_date === today).length;
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  document.getElementById('sstat-upcoming').textContent = shifts.filter((s) => s.shift_date >= today && s.shift_date <= in7).length;
}

function getFilteredShifts() {
  if (!currentShiftsSearch) return shifts;
  const term = currentShiftsSearch.toLowerCase();
  return shifts.filter((s) => s.employee_name.toLowerCase().includes(term));
}

function renderShiftsTable() {
  const rows = getFilteredShifts();
  shiftsTableBody.innerHTML = '';
  if (rows.length === 0) {
    shiftsEmpty.style.display = 'block';
    return;
  }
  shiftsEmpty.style.display = 'none';

  for (const s of rows) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.innerHTML = `
      <td>${s.shift_date}</td>
      <td>${s.start_time} – ${s.end_time}</td>
      <td>${escapeHtml(s.employee_name)}</td>
      <td><span class="dept-badge dept-${s.department}">${departmentLabel(s.department)}</span></td>
      <td>${escapeHtml(s.notes || '—')}</td>
      <td class="row-chevron">›</td>
    `;
    tr.addEventListener('click', () => openShiftModal(s.id));
    shiftsTableBody.appendChild(tr);
  }
}

function populateShiftEmployeeSelect() {
  const list = currentShiftsDeptFilter ? employees.filter((e) => e.department === currentShiftsDeptFilter) : employees;
  shiftEmployeeSelect.innerHTML = list.filter((e) => e.active).map((e) => (
    `<option value="${e.id}">${escapeHtml(e.full_name)} (${departmentLabel(e.department)})</option>`
  )).join('');
}

function openNewShiftModal() {
  currentShiftId = null;
  shiftForm.reset();
  shiftMessage.className = 'message';
  shiftMessage.textContent = '';
  document.getElementById('shift-modal-title').textContent = 'Nuevo turno';
  shiftFormSubmit.textContent = 'Crear turno';
  shiftDeleteBtn.style.display = 'none';
  shiftEmployeeSelect.disabled = false;
  populateShiftEmployeeSelect();
  shiftModalBackdrop.classList.add('open');
}

function openShiftModal(id) {
  const s = shifts.find((x) => x.id === id);
  if (!s) return;
  currentShiftId = id;
  shiftForm.reset();
  shiftMessage.className = 'message';
  shiftMessage.textContent = '';
  document.getElementById('shift-modal-title').textContent = 'Editar turno';
  shiftFormSubmit.textContent = 'Guardar cambios';
  shiftDeleteBtn.style.display = 'inline-flex';
  populateShiftEmployeeSelect();

  shiftEmployeeSelect.value = s.employee_id;
  shiftEmployeeSelect.disabled = true;
  document.getElementById('shift-date').value = s.shift_date;
  document.getElementById('shift-start').value = s.start_time;
  document.getElementById('shift-end').value = s.end_time;
  document.getElementById('shift-notes').value = s.notes || '';

  shiftModalBackdrop.classList.add('open');
}

function closeShiftModal() {
  shiftModalBackdrop.classList.remove('open');
  shiftEmployeeSelect.disabled = false;
  currentShiftId = null;
}

shiftForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  shiftMessage.className = 'message';
  shiftMessage.textContent = '';

  const body = {
    employeeId: Number(shiftEmployeeSelect.value),
    shiftDate: document.getElementById('shift-date').value,
    startTime: document.getElementById('shift-start').value,
    endTime: document.getElementById('shift-end').value,
    notes: document.getElementById('shift-notes').value.trim(),
  };

  const submitBtn = shiftFormSubmit;
  submitBtn.disabled = true;
  try {
    const isEdit = !!currentShiftId;
    const url = isEdit ? `/api/shifts/${currentShiftId}` : '/api/shifts';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el turno');

    showToast(isEdit ? 'Turno actualizado.' : 'Turno creado.');
    closeShiftModal();
    await loadShifts();
  } catch (err) {
    shiftMessage.className = 'message error';
    shiftMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

shiftDeleteBtn.addEventListener('click', async () => {
  if (!currentShiftId) return;
  if (!confirm('¿Eliminar este turno?')) return;
  await fetch(`/api/shifts/${currentShiftId}`, { method: 'DELETE' });
  closeShiftModal();
  await loadShifts();
  showToast('Turno eliminado.', 'danger');
});

document.getElementById('new-shift-btn').addEventListener('click', openNewShiftModal);
document.getElementById('shift-modal-close').addEventListener('click', closeShiftModal);
shiftModalBackdrop.addEventListener('click', (e) => {
  if (e.target === shiftModalBackdrop) closeShiftModal();
});

document.getElementById('shifts-search-input').addEventListener('input', (e) => {
  currentShiftsSearch = e.target.value.trim();
  renderShiftsTable();
});

document.querySelectorAll('.shifts-dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.shifts-dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentShiftsDeptFilter = btn.dataset.department;
    loadShifts();
  });
});

// ---------- Inventario ----------

let inventoryItems = [];
let currentInventoryDeptFilter = '';
let currentInventorySearch = '';
let currentInventoryId = null;

const inventoryTableBody = document.getElementById('inventory-table-body');
const inventoryEmpty = document.getElementById('inventory-empty');
const inventoryModalBackdrop = document.getElementById('inventory-modal-backdrop');
const inventoryForm = document.getElementById('inventory-form');
const inventoryMessage = document.getElementById('inventory-message');
const inventoryDepartmentField = document.getElementById('inventory-department-field');
const inventoryDepartmentSelect = document.getElementById('inventory-department');
const inventoryFormSubmit = document.getElementById('inventory-form-submit');
const inventoryDeleteBtn = document.getElementById('inventory-delete-btn');
const inventoryMovementsSection = document.getElementById('inventory-movements-section');
const movementsList = document.getElementById('movements-list');
const movementMessage = document.getElementById('movement-message');

async function loadInventory() {
  const params = new URLSearchParams();
  if (currentInventoryDeptFilter) params.set('department', currentInventoryDeptFilter);
  const query = params.toString();
  const res = await fetch(query ? `/api/inventory?${query}` : '/api/inventory');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  inventoryItems = await res.json();
  renderInventoryStats();
  renderInventoryTable();
}

function renderInventoryStats() {
  document.getElementById('istat-total').textContent = inventoryItems.length;
  document.getElementById('istat-low').textContent = inventoryItems.filter((i) => i.quantity <= i.min_quantity).length;
}

function getFilteredInventory() {
  if (!currentInventorySearch) return inventoryItems;
  const term = currentInventorySearch.toLowerCase();
  return inventoryItems.filter((i) => (
    i.name.toLowerCase().includes(term) || (i.category || '').toLowerCase().includes(term)
  ));
}

function inventoryStatusBadges(item) {
  const low = item.quantity <= item.min_quantity;
  return `
    <span class="dept-badge dept-${item.department}">${departmentLabel(item.department)}</span>
    <span class="status-pill ${low ? 'status-rechazado' : 'status-aprobado'}">${low ? 'Stock bajo' : 'OK'}</span>
  `;
}

function renderInventoryTable() {
  const rows = getFilteredInventory();
  inventoryTableBody.innerHTML = '';
  if (rows.length === 0) {
    inventoryEmpty.style.display = 'block';
    return;
  }
  inventoryEmpty.style.display = 'none';

  for (const i of rows) {
    const low = i.quantity <= i.min_quantity;
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.innerHTML = `
      <td>${escapeHtml(i.name)}</td>
      <td>${escapeHtml(i.category || '—')}</td>
      <td><span class="dept-badge dept-${i.department}">${departmentLabel(i.department)}</span></td>
      <td>${i.quantity} ${escapeHtml(i.unit)}</td>
      <td>${i.min_quantity} ${escapeHtml(i.unit)}</td>
      <td><span class="status-pill ${low ? 'status-rechazado' : 'status-aprobado'}">${low ? 'Stock bajo' : 'OK'}</span></td>
      <td class="row-chevron">›</td>
    `;
    tr.addEventListener('click', () => openInventoryModal(i.id));
    inventoryTableBody.appendChild(tr);
  }
}

function resetInventoryForm() {
  inventoryForm.reset();
  document.getElementById('inventory-unit').value = 'unidad';
  inventoryMessage.className = 'message';
  inventoryMessage.textContent = '';
  movementMessage.className = 'message';
  movementMessage.textContent = '';
}

function openNewInventoryModal() {
  currentInventoryId = null;
  resetInventoryForm();
  document.getElementById('inventory-modal-title').textContent = 'Nuevo insumo';
  document.getElementById('inventory-modal-sub').textContent = 'Registrar un nuevo insumo o medicamento en el stock.';
  document.getElementById('inventory-modal-status').innerHTML = '';
  inventoryFormSubmit.textContent = 'Crear insumo';
  inventoryDeleteBtn.style.display = 'none';
  inventoryMovementsSection.style.display = 'none';
  inventoryDepartmentField.style.display = scopedDepartment ? 'none' : 'block';

  const initialDept = scopedDepartment || currentInventoryDeptFilter || 'sams';
  inventoryDepartmentSelect.value = initialDept;

  inventoryModalBackdrop.classList.add('open');
}

async function openInventoryModal(id) {
  const item = inventoryItems.find((x) => x.id === id);
  if (!item) return;
  currentInventoryId = id;
  resetInventoryForm();

  document.getElementById('inventory-modal-title').textContent = item.name;
  document.getElementById('inventory-modal-sub').textContent = item.category || '';
  document.getElementById('inventory-modal-status').innerHTML = inventoryStatusBadges(item);
  inventoryFormSubmit.textContent = 'Guardar cambios';
  inventoryDeleteBtn.style.display = 'inline-flex';
  inventoryMovementsSection.style.display = 'block';
  inventoryDepartmentField.style.display = 'none';

  document.getElementById('inventory-name').value = item.name;
  document.getElementById('inventory-category').value = item.category || '';
  document.getElementById('inventory-unit').value = item.unit;
  document.getElementById('inventory-min').value = item.min_quantity;

  inventoryModalBackdrop.classList.add('open');
  await loadMovements(id);
}

function closeInventoryModal() {
  inventoryModalBackdrop.classList.remove('open');
  currentInventoryId = null;
}

inventoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  inventoryMessage.className = 'message';
  inventoryMessage.textContent = '';

  const name = document.getElementById('inventory-name').value.trim();
  const category = document.getElementById('inventory-category').value.trim();
  const unit = document.getElementById('inventory-unit').value.trim();
  const minQuantity = Number(document.getElementById('inventory-min').value) || 0;
  const department = scopedDepartment || inventoryDepartmentSelect.value;

  const submitBtn = inventoryFormSubmit;
  submitBtn.disabled = true;
  try {
    const isEdit = !!currentInventoryId;
    const url = isEdit ? `/api/inventory/${currentInventoryId}` : '/api/inventory';
    const method = isEdit ? 'PATCH' : 'POST';
    const body = isEdit
      ? { name, category, unit, minQuantity }
      : { name, category, unit, minQuantity, department };

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el insumo');

    showToast(isEdit ? 'Insumo actualizado.' : 'Insumo creado.');
    await loadInventory();
    if (isEdit) {
      await openInventoryModal(currentInventoryId);
    } else {
      closeInventoryModal();
    }
  } catch (err) {
    inventoryMessage.className = 'message error';
    inventoryMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

inventoryDeleteBtn.addEventListener('click', async () => {
  if (!currentInventoryId) return;
  if (!confirm('¿Eliminar este insumo y su historial de movimientos?')) return;
  await fetch(`/api/inventory/${currentInventoryId}`, { method: 'DELETE' });
  closeInventoryModal();
  await loadInventory();
  showToast('Insumo eliminado.', 'danger');
});

async function loadMovements(itemId) {
  const res = await fetch(`/api/inventory/${itemId}/movements`);
  if (!res.ok) return;
  const rows = await res.json();
  renderMovementsList(rows);
}

function renderMovementsList(rows) {
  movementsList.innerHTML = '';
  if (rows.length === 0) {
    movementsList.innerHTML = '<div class="staff-empty">Todavía no hay movimientos registrados.</div>';
    return;
  }
  for (const m of rows) {
    const row = document.createElement('div');
    row.className = 'staff-row';
    row.innerHTML = `
      <div class="staff-meta">
        <span class="status-pill ${m.type === 'entrada' ? 'status-aprobado' : 'status-rechazado'}">${m.type === 'entrada' ? '+' : '-'}${m.quantity}</span>
        <span class="staff-username">${escapeHtml(m.reason || 'Sin motivo especificado')}</span>
      </div>
      <span class="muted-link">${formatDate(m.created_at)}</span>
    `;
    movementsList.appendChild(row);
  }
}

document.getElementById('movement-add-btn').addEventListener('click', async () => {
  if (!currentInventoryId) return;
  movementMessage.className = 'message';
  movementMessage.textContent = '';

  const type = document.getElementById('movement-type').value;
  const quantity = Number(document.getElementById('movement-quantity').value);
  const reason = document.getElementById('movement-reason').value.trim();

  if (!Number.isFinite(quantity) || quantity <= 0) {
    movementMessage.className = 'message error';
    movementMessage.textContent = 'Ingresá una cantidad válida.';
    return;
  }

  try {
    const res = await fetch(`/api/inventory/${currentInventoryId}/movements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, quantity, reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo registrar el movimiento');

    document.getElementById('movement-quantity').value = '';
    document.getElementById('movement-reason').value = '';
    await loadMovements(currentInventoryId);
    await loadInventory();
    const item = inventoryItems.find((x) => x.id === currentInventoryId);
    if (item) document.getElementById('inventory-modal-status').innerHTML = inventoryStatusBadges(item);
    showToast('Movimiento registrado.');
  } catch (err) {
    movementMessage.className = 'message error';
    movementMessage.textContent = err.message;
  }
});

document.getElementById('new-inventory-btn').addEventListener('click', openNewInventoryModal);
document.getElementById('inventory-modal-close').addEventListener('click', closeInventoryModal);
inventoryModalBackdrop.addEventListener('click', (e) => {
  if (e.target === inventoryModalBackdrop) closeInventoryModal();
});

document.getElementById('inventory-search-input').addEventListener('input', (e) => {
  currentInventorySearch = e.target.value.trim();
  renderInventoryTable();
});

document.querySelectorAll('.inventory-dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.inventory-dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentInventoryDeptFilter = btn.dataset.department;
    loadInventory();
  });
});

// ---------- Atenciones (fichas clínicas / informes de intervención) ----------

let cases = [];
let currentCasesDeptFilter = '';
let currentCasesStatusFilter = '';
let currentCasesSearch = '';
let currentCaseId = null;

const casesTableBody = document.getElementById('cases-table-body');
const casesEmpty = document.getElementById('cases-empty');
const caseModalBackdrop = document.getElementById('case-modal-backdrop');
const caseForm = document.getElementById('case-form');
const caseMessage = document.getElementById('case-message');
const caseDepartmentField = document.getElementById('case-department-field');
const caseDepartmentSelect = document.getElementById('case-department');
const caseFormSubmit = document.getElementById('case-form-submit');
const caseDeleteBtn = document.getElementById('case-delete-btn');
const caseResponsibleSelect = document.getElementById('case-responsible');
const caseStatusField = document.getElementById('case-status-field');
const caseStatusSelect = document.getElementById('case-status');

async function loadCases() {
  const params = new URLSearchParams();
  if (currentCasesDeptFilter) params.set('department', currentCasesDeptFilter);
  if (currentCasesStatusFilter) params.set('status', currentCasesStatusFilter);
  const query = params.toString();
  const res = await fetch(query ? `/api/cases?${query}` : '/api/cases');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  cases = await res.json();
  renderCasesStats();
  renderCasesTable();
}

function renderCasesStats() {
  document.getElementById('cstat-total').textContent = cases.length;
  document.getElementById('cstat-open').textContent = cases.filter((c) => c.status === 'abierta').length;
  document.getElementById('cstat-closed').textContent = cases.filter((c) => c.status === 'cerrada').length;
}

function getFilteredCases() {
  if (!currentCasesSearch) return cases;
  const term = currentCasesSearch.toLowerCase();
  return cases.filter((c) => c.subject_name.toLowerCase().includes(term));
}

function renderCasesTable() {
  const rows = getFilteredCases();
  casesTableBody.innerHTML = '';
  if (rows.length === 0) {
    casesEmpty.style.display = 'block';
    return;
  }
  casesEmpty.style.display = 'none';

  for (const c of rows) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.innerHTML = `
      <td>${formatDate(c.created_at)}</td>
      <td><span class="dept-badge dept-${c.department}">${departmentLabel(c.department)}</span></td>
      <td>${escapeHtml(c.subject_name)}</td>
      <td>${escapeHtml(c.responsible_name || '—')}</td>
      <td><span class="status-pill ${c.status === 'abierta' ? 'status-pendiente' : 'status-aprobado'}">${c.status === 'abierta' ? 'Abierta' : 'Cerrada'}</span></td>
      <td class="row-chevron">›</td>
    `;
    tr.addEventListener('click', () => openCaseModal(c.id));
    casesTableBody.appendChild(tr);
  }
}

function subjectLabelForDepartment(department) {
  return department === 'safd' ? 'Víctima / afectado' : 'Paciente';
}

function updateCaseLabels(department) {
  document.getElementById('case-subject-label').textContent = subjectLabelForDepartment(department);
  document.getElementById('case-summary-label').textContent = department === 'safd' ? 'Motivo de la intervención' : 'Diagnóstico / motivo';
  document.getElementById('case-treatment-label').textContent = department === 'safd' ? 'Acción tomada (opcional)' : 'Tratamiento aplicado (opcional)';
}

function populateCaseResponsibleSelect(department) {
  const list = employees.filter((e) => e.department === department && e.active);
  caseResponsibleSelect.innerHTML = '<option value="">Sin asignar</option>' + list.map((e) => (
    `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`
  )).join('');
}

function resetCaseForm() {
  caseForm.reset();
  caseMessage.className = 'message';
  caseMessage.textContent = '';
}

async function openNewCaseModal() {
  if (employees.length === 0) await loadEmployees();
  currentCaseId = null;
  resetCaseForm();

  document.getElementById('case-modal-title').textContent = 'Nueva atención';
  document.getElementById('case-modal-sub').textContent = 'Registrar una nueva atención médica o de intervención.';
  document.getElementById('case-modal-department').innerHTML = '';
  document.getElementById('case-modal-status').innerHTML = '';
  caseFormSubmit.textContent = 'Crear atención';
  caseDeleteBtn.style.display = 'none';
  caseDepartmentField.style.display = scopedDepartment ? 'none' : 'block';
  caseStatusField.style.display = 'none';

  const initialDept = scopedDepartment || currentCasesDeptFilter || 'sams';
  caseDepartmentSelect.value = initialDept;
  updateCaseLabels(initialDept);
  populateCaseResponsibleSelect(initialDept);

  caseModalBackdrop.classList.add('open');
}

async function openCaseModal(id) {
  const c = cases.find((x) => x.id === id);
  if (!c) return;
  if (employees.length === 0) await loadEmployees();
  currentCaseId = id;
  resetCaseForm();

  document.getElementById('case-modal-title').textContent = c.subject_name;
  document.getElementById('case-modal-sub').textContent = `Registrada el ${formatDate(c.created_at)}`;
  document.getElementById('case-modal-department').innerHTML = `<span class="dept-badge dept-${c.department}">${departmentLabel(c.department)}</span>`;
  document.getElementById('case-modal-status').innerHTML = `<span class="status-pill ${c.status === 'abierta' ? 'status-pendiente' : 'status-aprobado'}">${c.status === 'abierta' ? 'Abierta' : 'Cerrada'}</span>`;
  caseFormSubmit.textContent = 'Guardar cambios';
  caseDeleteBtn.style.display = 'inline-flex';
  caseDepartmentField.style.display = 'none';
  caseStatusField.style.display = 'block';

  updateCaseLabels(c.department);
  populateCaseResponsibleSelect(c.department);

  document.getElementById('case-subject').value = c.subject_name;
  document.getElementById('case-age').value = c.age || '';
  document.getElementById('case-location').value = c.location || '';
  document.getElementById('case-summary').value = c.summary;
  document.getElementById('case-treatment').value = c.treatment || '';
  caseResponsibleSelect.value = c.responsible_employee_id || '';
  caseStatusSelect.value = c.status;

  caseModalBackdrop.classList.add('open');
}

function closeCaseModal() {
  caseModalBackdrop.classList.remove('open');
  currentCaseId = null;
}

caseDepartmentSelect.addEventListener('change', () => {
  updateCaseLabels(caseDepartmentSelect.value);
  populateCaseResponsibleSelect(caseDepartmentSelect.value);
});

caseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  caseMessage.className = 'message';
  caseMessage.textContent = '';

  const isEdit = !!currentCaseId;
  const department = isEdit ? cases.find((x) => x.id === currentCaseId).department : (scopedDepartment || caseDepartmentSelect.value);

  const body = {
    subjectName: document.getElementById('case-subject').value.trim(),
    age: document.getElementById('case-age').value || undefined,
    location: document.getElementById('case-location').value.trim(),
    summary: document.getElementById('case-summary').value.trim(),
    treatment: document.getElementById('case-treatment').value.trim(),
    responsibleEmployeeId: caseResponsibleSelect.value || null,
  };
  if (!isEdit) body.department = department;
  else body.status = caseStatusSelect.value;

  const submitBtn = caseFormSubmit;
  submitBtn.disabled = true;
  try {
    const url = isEdit ? `/api/cases/${currentCaseId}` : '/api/cases';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la atención');

    showToast(isEdit ? 'Atención actualizada.' : 'Atención creada.');
    closeCaseModal();
    await loadCases();
  } catch (err) {
    caseMessage.className = 'message error';
    caseMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

caseDeleteBtn.addEventListener('click', async () => {
  if (!currentCaseId) return;
  if (!confirm('¿Eliminar esta atención permanentemente?')) return;
  await fetch(`/api/cases/${currentCaseId}`, { method: 'DELETE' });
  closeCaseModal();
  await loadCases();
  showToast('Atención eliminada.', 'danger');
});

document.getElementById('new-case-btn').addEventListener('click', openNewCaseModal);
document.getElementById('case-modal-close').addEventListener('click', closeCaseModal);
caseModalBackdrop.addEventListener('click', (e) => {
  if (e.target === caseModalBackdrop) closeCaseModal();
});

document.getElementById('cases-search-input').addEventListener('input', (e) => {
  currentCasesSearch = e.target.value.trim();
  renderCasesTable();
});

document.querySelectorAll('.cases-dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cases-dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentCasesDeptFilter = btn.dataset.department;
    loadCases();
  });
});

document.querySelectorAll('.cases-status-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cases-status-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentCasesStatusFilter = btn.dataset.status;
    loadCases();
  });
});

checkSession().then(() => {
  loadApplications();
  loadRanks();
});
