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

const tableBody = document.getElementById('table-body');
const emptyEl = document.getElementById('empty');
const modalBackdrop = document.getElementById('modal-backdrop');
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
  whoamiEl.textContent = scopedDepartment
    ? `${data.username} · ${departmentLabel(scopedDepartment)}`
    : data.username;

  if (scopedDepartment) {
    // Staff restringido a un departamento: no tiene sentido mostrar el
    // selector, el servidor ya solo le devuelve ese departamento.
    deptFilterRow.style.display = 'none';
    currentDepartmentFilter = scopedDepartment;

    personalDeptFilterRow.style.display = 'none';
    currentPersonalDeptFilter = scopedDepartment;
    employeeDepartmentField.style.display = 'none';
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
      <td><span class="status-pill status-${a.status}">${capitalize(a.status)}</span></td>
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

  document.getElementById('modal-status').innerHTML = `<span class="status-pill status-${a.status}">${capitalize(a.status)}</span>`;

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
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    await fetch(`/api/applications/${currentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewNotes }),
    });
    closeModal();
    await loadApplications();
    showToast('Postulación actualizada.');
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

// ---------- Personal ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    tabPostulaciones.style.display = tab === 'postulaciones' ? 'block' : 'none';
    tabPersonal.style.display = tab === 'personal' ? 'block' : 'none';
    if (tab === 'personal') {
      if (ranks.length === 0) loadRanks();
      loadEmployees();
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

function populateRankSelect(department, selectedRankId) {
  const list = ranksForDepartment(department);
  employeeRankSelect.innerHTML = list.map((r) => (
    `<option value="${r.id}">${r.level} — ${escapeHtml(r.name)}</option>`
  )).join('');
  if (selectedRankId) employeeRankSelect.value = selectedRankId;
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

function employeeCardHtml(e) {
  const tier = tierForLevel(e.rank_level);
  return `
    <div class="employee-card${e.active ? '' : ' is-inactive'}" style="--tier-color:${tier.solid}" data-employee-id="${e.id}">
      <div class="employee-card-top">
        <div class="employee-avatar">${escapeHtml(initials(e.full_name))}</div>
        <div class="employee-card-name-wrap">
          <div class="employee-card-name">${escapeHtml(e.full_name)}</div>
          <span class="rank-badge" style="background:${tier.soft};color:${tier.solid}">Nv.${e.rank_level} · ${escapeHtml(e.rank_name)}</span>
        </div>
        <span class="employee-status-dot${e.active ? '' : ' is-inactive'}" title="${e.active ? 'Activo' : 'Inactivo'}"></span>
      </div>
      <div class="employee-card-meta">
        <span>☎ ${escapeHtml(e.phone || 'Sin teléfono')}</span>
        <span>#${escapeHtml(e.discord_info || 'Sin Discord')}</span>
        <span>$${Number(e.rank_hourly_rate).toFixed(2)}/h</span>
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

function employeeGroupHtml(dept, list) {
  const deptList = list.filter((e) => e.department === dept);
  return `
    <div class="employee-group">
      <div class="employee-group-header">
        <span class="dept-badge dept-${dept}">${departmentLabel(dept)}</span>
        <span class="employee-group-count">${deptList.length} empleado${deptList.length === 1 ? '' : 's'}</span>
      </div>
      ${deptList.length === 0
        ? '<div class="staff-empty">Sin empleados en este departamento.</div>'
        : `<div class="employee-grid">${deptList.map(employeeCardHtml).join('')}</div>`}
    </div>
  `;
}

function renderEmployeesBoard() {
  const employeesSearchEmpty = document.getElementById('employees-search-empty');

  if (employees.length === 0) {
    employeesColumns.innerHTML = '';
    employeesColumns.className = '';
    employeesEmpty.style.display = 'block';
    employeesSearchEmpty.style.display = 'none';
    return;
  }
  employeesEmpty.style.display = 'none';

  const filtered = getFilteredEmployees();
  if (filtered.length === 0) {
    employeesColumns.innerHTML = '';
    employeesColumns.className = '';
    employeesSearchEmpty.style.display = 'block';
    return;
  }
  employeesSearchEmpty.style.display = 'none';

  const groups = scopedDepartment
    ? [scopedDepartment]
    : (currentPersonalDeptFilter ? [currentPersonalDeptFilter] : ['sams', 'safd']);

  employeesColumns.className = groups.length === 2 ? 'employees-columns two-col' : 'employees-columns';
  employeesColumns.innerHTML = groups.map((dept) => employeeGroupHtml(dept, filtered)).join('');

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
});

checkSession().then(() => {
  loadApplications();
  loadRanks();
});
