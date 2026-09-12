let applications = [];
let currentStatusFilter = '';
let currentDepartmentFilter = '';
let currentSearch = '';
let currentId = null;
let scopedDepartment = null;
let currentUsername = null;
let hasHrAccess = false;
let hasAcademyAccess = false;
let isStaff = false;
let isSuperadmin = false;

function canManage() {
  return isStaff || isSuperadmin;
}

let ranks = [];
let employees = [];
let currentPersonalDeptFilter = '';
let currentPersonalSearch = '';
let currentEmployeeId = null;

const DEPARTMENT_LABELS = { sams: 'SAMS', safd: 'SAFD' };
const STATUS_LABELS = { pendiente: 'Pendiente', en_revision: 'En revisión', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const PAGE_TITLES = {
  fichaje: ['Mi Fichaje', 'Marcá tu entrada y salida, y consultá tu historial.'],
  informes: ['Informes', 'Completá las plantillas de tu departamento y revisá tu historial.'],
  postulaciones: ['Postulaciones', 'Revisá, filtrá y gestioná las postulaciones a SAMS y SAFD.'],
  personal: ['Personal', 'Roster de empleados, rangos, roles y nómina del SAED.'],
  fichajes: ['Fichajes', 'Control de entrada y salida del personal.'],
  inventario: ['Inventario', 'Stock de insumos y medicamentos de SAMS y SAFD.'],
  atenciones: ['Atenciones', 'Fichas de pacientes e informes de intervención.'],
  academia: ['Academia', 'Estudiantes, cursos y evaluaciones de la formación del SAED.'],
};
const CADET_STATUS_LABELS = { activo: 'Activo', graduado: 'Graduado', expulsado: 'Expulsado', baja: 'Baja' };
const CADET_STATUS_PILL_CLASS = { activo: 'status-en_revision', graduado: 'status-aprobado', expulsado: 'status-rechazado', baja: 'status-baja' };

const tableBody = document.getElementById('table-body');
const emptyEl = document.getElementById('empty');
const modalBackdrop = document.getElementById('modal-backdrop');
const whoamiEl = document.getElementById('whoami');
const searchInput = document.getElementById('search-input');
const toastContainer = document.getElementById('toast-container');
const deptFilterRow = document.getElementById('dept-filter-row');

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
  isStaff = !!data.isStaff;
  isSuperadmin = !!data.isSuperadmin;
  hasHrAccess = !!data.hrAccess;
  hasAcademyAccess = !!data.academyAccess;
  // null = ve todo (superadmin); si no, el empleado queda atado a su
  // propio departamento en todos los filtros del panel.
  scopedDepartment = isSuperadmin ? null : data.department;
  currentUsername = data.username;

  whoamiEl.textContent = data.fullName || data.username;
  document.getElementById('whoami-avatar').textContent = initials(data.fullName || data.username);
  document.getElementById('whoami-scope').textContent = isSuperadmin
    ? 'Todos los departamentos'
    : departmentLabel(data.department);

  if (scopedDepartment) {
    // Staff restringido a un departamento: no tiene sentido mostrar el
    // selector, el servidor ya solo le devuelve ese departamento.
    deptFilterRow.style.display = 'none';
    currentDepartmentFilter = scopedDepartment;

    personalDeptFilterRow.style.display = 'none';
    currentPersonalDeptFilter = scopedDepartment;
    employeeDepartmentField.style.display = 'none';

    document.getElementById('attendance-dept-filter-row').style.display = 'none';
    currentAttendanceDeptFilter = scopedDepartment;

    document.getElementById('inventory-dept-filter-row').style.display = 'none';
    currentInventoryDeptFilter = scopedDepartment;

    document.getElementById('cases-dept-filter-row').style.display = 'none';
    currentCasesDeptFilter = scopedDepartment;

    document.getElementById('academia-dept-filter-row').style.display = 'none';
    currentCadetsDeptFilter = scopedDepartment;

    document.getElementById('academia-eval-dept-filter-row').style.display = 'none';
    currentEvalDeptFilter = scopedDepartment;
  }
  if (isSuperadmin) {
    // Solo el superadmin define tarifas de pago por rango y administra roles.
    ratesBtn.style.display = 'inline-flex';
    document.getElementById('roles-btn').style.display = 'inline-flex';
  }

  // Los módulos de gestión son solo para staff/superadmin; un empleado
  // común únicamente ve "Mi Fichaje". Fichajes (ver todo el personal) es
  // aparte: superadmin o quien tenga el permiso explícito de RRHH/Dirección.
  const canManageNow = canManage();
  const canViewAttendance = isSuperadmin || hasHrAccess;
  [
    'nav-section-reclutamiento', 'nav-postulaciones-btn',
    'nav-personal-btn', 'nav-inventario-btn', 'nav-atenciones-btn', 'nav-section-ops',
  ].forEach((id) => {
    document.getElementById(id).style.display = canManageNow ? '' : 'none';
  });
  document.getElementById('nav-section-rrhh').style.display = (canManageNow || canViewAttendance) ? '' : 'none';
  document.getElementById('fichajes-nav-btn').style.display = canViewAttendance ? '' : 'none';
  manageTemplatesBtn.style.display = canManageNow ? 'inline-flex' : 'none';

  // La Academia la administra la división RTD (o el superadmin); no es
  // parte del grupo general de módulos de staff.
  const canManageAcademy = isSuperadmin || hasAcademyAccess;
  document.getElementById('nav-academia-btn').style.display = canManageAcademy ? '' : 'none';
  if (canManageAcademy) document.getElementById('nav-section-reclutamiento').style.display = '';

  switchTab(canManageNow ? 'postulaciones' : 'fichaje');
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

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    const res = await fetch(`/api/applications/${currentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewNotes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo actualizar la postulación');
    closeModal();
    await loadApplications();
    showToast(status === 'aprobado' ? 'Postulación aprobada y sumada a la Academia como estudiante.' : 'Postulación actualizada.');
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

const TAB_IDS = ['fichaje', 'informes', 'postulaciones', 'academia', 'personal', 'fichajes', 'inventario', 'atenciones'];

async function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  closeSidebar();

  TAB_IDS.forEach((id) => {
    document.getElementById(`tab-${id}`).style.display = tab === id ? 'block' : 'none';
  });

  const [title, subtitle] = PAGE_TITLES[tab] || ['', ''];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle;

  if (tab === 'fichaje') {
    loadMyClockStatus();
    loadMyClockHistory();
  } else if (tab === 'informes') {
    await loadTemplates();
    loadMyReports();
    loadPendingReports();
  } else if (tab === 'postulaciones') {
    loadApplications();
  } else if (tab === 'personal') {
    if (ranks.length === 0) loadRanks();
    if (employeeRoles.length === 0) loadEmployeeRoles();
    loadEmployees();
  } else if (tab === 'fichajes') {
    loadAttendance();
  } else if (tab === 'inventario') {
    loadInventory();
  } else if (tab === 'atenciones') {
    if (employees.length === 0) await loadEmployees();
    loadCases();
  } else if (tab === 'academia') {
    if (employees.length === 0) await loadEmployees();
    if (academyCourses.length === 0) await loadAcademyCourses();
    loadCadets();
  }
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ---------- Mi Fichaje (cualquier cuenta logueada, sea staff o no) ----------

const clockStatusEl = document.getElementById('clock-status');
const clockSinceEl = document.getElementById('clock-since');
const clockBtn = document.getElementById('clock-btn');
const clockMessage = document.getElementById('clock-message');
const myHistoryList = document.getElementById('my-history-list');
const myHistoryEmpty = document.getElementById('my-history-empty');

async function loadMyClockStatus() {
  const res = await fetch('/api/attendance/me/status');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const data = await res.json();
  if (data.clockedIn) {
    clockStatusEl.textContent = 'Fichado — turno en curso';
    clockStatusEl.className = 'clock-status is-in';
    clockSinceEl.textContent = `Desde las ${formatDate(data.since)}`;
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

async function loadMyClockHistory() {
  const res = await fetch('/api/attendance/me/history');
  if (!res.ok) return;
  const rows = await res.json();
  if (rows.length === 0) {
    myHistoryList.innerHTML = '';
    myHistoryEmpty.style.display = 'block';
    return;
  }
  myHistoryEmpty.style.display = 'none';
  myHistoryList.innerHTML = rows.map((r) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${formatDate(r.clock_in)}</span>
        <span class="muted-link">→ ${r.clock_out ? formatDate(r.clock_out) : 'en curso'}</span>
      </div>
      <span class="status-pill ${r.clock_out ? 'status-aprobado' : 'status-pendiente'}">${attendanceDuration(r.clock_in, r.clock_out)}</span>
    </div>
  `).join('');
}

clockBtn.addEventListener('click', async () => {
  clockBtn.disabled = true;
  clockMessage.className = 'message';
  clockMessage.textContent = '';
  try {
    const res = await fetch('/api/attendance/me/clock', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo registrar el fichaje');

    showToast(data.clockedIn ? 'Entrada registrada.' : 'Salida registrada.');
    await loadMyClockStatus();
    await loadMyClockHistory();
  } catch (err) {
    clockMessage.className = 'message error';
    clockMessage.textContent = err.message;
    clockBtn.disabled = false;
  }
});

// ---------- Informes (plantillas por departamento) ----------

let reportTemplates = [];
let myReports = [];
let currentTemplateFields = [];
let currentEditingTemplateId = null;
let currentFillTemplate = null;
let currentSubmissionsTemplateId = null;

const templatesListEl = document.getElementById('templates-list');
const templatesEmptyEl = document.getElementById('templates-empty');
const myReportsListEl = document.getElementById('my-reports-list');
const myReportsEmptyEl = document.getElementById('my-reports-empty');
const manageTemplatesBtn = document.getElementById('manage-templates-btn');
const templatesModalBackdrop = document.getElementById('templates-modal-backdrop');
const templatesManageView = document.getElementById('templates-manage-view');
const templatesManageItems = document.getElementById('templates-manage-items');
const templateEditor = document.getElementById('template-editor');
const templateNameInput = document.getElementById('template-name');
const templateDescriptionInput = document.getElementById('template-description');
const templateDepartmentField = document.getElementById('template-department-field');
const templateDepartmentSelect = document.getElementById('template-department');
const templateActiveField = document.getElementById('template-active-field');
const templateActiveCheckbox = document.getElementById('template-active');
const templateFieldsList = document.getElementById('template-fields-list');
const templateMessage = document.getElementById('template-message');
const fillReportModalBackdrop = document.getElementById('fill-report-modal-backdrop');
const fillReportForm = document.getElementById('fill-report-form');
const fillReportFields = document.getElementById('fill-report-fields');
const fillReportMessage = document.getElementById('fill-report-message');
const submissionsModalBackdrop = document.getElementById('submissions-modal-backdrop');
const submissionsListEl = document.getElementById('submissions-list');
const submissionsEmptyEl = document.getElementById('submissions-empty');
const fillReportTitleInput = document.getElementById('fill-report-title-input');
const pendingReportsCard = document.getElementById('pending-reports-card');
const pendingReportsList = document.getElementById('pending-reports-list');
const pendingReportsEmpty = document.getElementById('pending-reports-empty');
const pendingReportsCount = document.getElementById('pending-reports-count');

async function loadTemplates() {
  const res = await fetch('/api/report-templates');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  reportTemplates = await res.json();
  renderTemplatesList();
}

function renderTemplatesList() {
  const activeTemplates = reportTemplates.filter((t) => t.active);
  templatesListEl.innerHTML = '';
  if (activeTemplates.length === 0) {
    templatesEmptyEl.style.display = 'block';
    return;
  }
  templatesEmptyEl.style.display = 'none';
  for (const t of activeTemplates) {
    const row = document.createElement('div');
    row.className = 'staff-row';
    row.innerHTML = `
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(t.name)}</span>
        ${t.description ? `<span class="muted-link">${escapeHtml(t.description)}</span>` : ''}
      </div>
      <button class="btn btn-primary btn-sm" data-fill-template="${t.id}">Completar</button>
    `;
    templatesListEl.appendChild(row);
  }
  templatesListEl.querySelectorAll('[data-fill-template]').forEach((btn) => {
    btn.addEventListener('click', () => openFillReportModal(Number(btn.dataset.fillTemplate)));
  });
}

async function loadMyReports() {
  const res = await fetch('/api/report-submissions/mine');
  if (!res.ok) return;
  myReports = await res.json();
  renderMyReports();
}

const REPORT_STATUS_LABELS = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const REPORT_STATUS_PILL_CLASS = { pendiente: 'status-pendiente', aprobado: 'status-aprobado', rechazado: 'status-rechazado' };

function reportStatusPill(status) {
  return `<span class="status-pill ${REPORT_STATUS_PILL_CLASS[status] || 'status-pendiente'}">${REPORT_STATUS_LABELS[status] || status}</span>`;
}

function reportPdfLinks(id) {
  return `
    <a class="btn btn-ghost btn-sm" href="/api/report-submissions/${id}/pdf" target="_blank" rel="noopener">Ver PDF</a>
    <a class="btn btn-ghost btn-sm" href="/api/report-submissions/${id}/pdf?download=1">Descargar</a>
  `;
}

function renderMyReports() {
  myReportsListEl.innerHTML = '';
  if (myReports.length === 0) {
    myReportsEmptyEl.style.display = 'block';
    return;
  }
  myReportsEmptyEl.style.display = 'none';
  myReportsListEl.innerHTML = myReports.map((r) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(r.title || r.template_name)}</span>
        ${reportStatusPill(r.status)}
        <span class="muted-link">${escapeHtml(r.template_name)} · ${formatDate(r.created_at)}</span>
      </div>
      ${reportPdfLinks(r.id)}
    </div>
  `).join('');
}

// Bandeja de revisión: todos los informes pendientes del departamento en
// un solo lugar, visible apenas se entra a Informes (antes había que
// entrar a "Gestionar plantillas" y abrir cada una para encontrarlos).
let pendingReports = [];

async function loadPendingReports() {
  if (!canManage()) {
    pendingReportsCard.style.display = 'none';
    return;
  }
  pendingReportsCard.style.display = 'block';
  const res = await fetch('/api/report-submissions/pending');
  if (!res.ok) return;
  pendingReports = await res.json();
  renderPendingReports();
}

function renderPendingReports() {
  pendingReportsCount.textContent = pendingReports.length;
  if (pendingReports.length === 0) {
    pendingReportsList.innerHTML = '';
    pendingReportsEmpty.style.display = 'block';
    return;
  }
  pendingReportsEmpty.style.display = 'none';
  pendingReportsList.innerHTML = pendingReports.map((s) => `
    <div class="field-row">
      <div class="field-row-footer" style="margin-top:0;">
        <span class="staff-username">${escapeHtml(s.title || s.template_name)}</span>
        <span class="muted-link">${escapeHtml(s.template_name)} · ${escapeHtml(s.employee_name)} · ${formatDate(s.created_at)}</span>
      </div>
      <div class="review-decision" style="margin-top:10px;">
        <button class="btn btn-ok review-btn" data-pending-review="${s.id}" data-status="aprobado"><span class="review-btn-icon">✓</span> Aprobar</button>
        <button class="btn btn-danger review-btn" data-pending-review="${s.id}" data-status="rechazado"><span class="review-btn-icon">✕</span> Rechazar</button>
      </div>
      <div class="submit-row" style="margin-top:10px;">
        ${reportPdfLinks(s.id)}
      </div>
    </div>
  `).join('');

  pendingReportsList.querySelectorAll('[data-pending-review]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await fetch(`/api/report-submissions/${btn.dataset.pendingReview}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status }),
      });
      if (res.ok) {
        showToast(btn.dataset.status === 'aprobado' ? 'Informe aprobado.' : 'Informe rechazado.', btn.dataset.status === 'aprobado' ? undefined : 'danger');
        await loadPendingReports();
      } else {
        const data = await res.json();
        showToast(data.error || 'No se pudo actualizar el informe.', 'danger');
      }
    });
  });
}

function renderFillField(f) {
  if (f.type === 'heading') {
    return `<h3 class="modal-section-title">${escapeHtml(f.label)}</h3>`;
  }
  const req = f.required ? 'required' : '';
  const labelHtml = `<label for="fill-field-${escapeHtml(f.key)}">${escapeHtml(f.label)}${f.required ? '' : ' <span class="hint">(opcional)</span>'}</label>`;
  if (f.type === 'textarea') {
    return `${labelHtml}<textarea id="fill-field-${escapeHtml(f.key)}" data-field-key="${escapeHtml(f.key)}" ${req}></textarea>`;
  }
  if (f.type === 'select') {
    const options = (f.options || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    return `${labelHtml}<select id="fill-field-${escapeHtml(f.key)}" data-field-key="${escapeHtml(f.key)}" ${req}><option value="" disabled selected>Elegí una opción</option>${options}</select>`;
  }
  const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
  return `${labelHtml}<input type="${type}" id="fill-field-${escapeHtml(f.key)}" data-field-key="${escapeHtml(f.key)}" ${req} />`;
}

function openFillReportModal(templateId) {
  const t = reportTemplates.find((x) => x.id === templateId);
  if (!t) return;
  currentFillTemplate = t;
  document.getElementById('fill-report-title').textContent = t.name;
  document.getElementById('fill-report-sub').textContent = t.description || '';
  fillReportMessage.className = 'message';
  fillReportMessage.textContent = '';
  fillReportForm.reset();

  fillReportFields.innerHTML = t.fields.map((f) => renderFillField(f)).join('');
  fillReportModalBackdrop.classList.add('open');
  fillReportTitleInput.focus();
}

function closeFillReportModal() {
  fillReportModalBackdrop.classList.remove('open');
  currentFillTemplate = null;
}

fillReportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentFillTemplate) return;
  fillReportMessage.className = 'message';
  fillReportMessage.textContent = '';

  const title = fillReportTitleInput.value.trim();
  const data = {};
  fillReportFields.querySelectorAll('[data-field-key]').forEach((el) => {
    data[el.dataset.fieldKey] = el.value;
  });

  const submitBtn = document.getElementById('fill-report-submit');
  submitBtn.disabled = true;
  try {
    const res = await fetch(`/api/report-templates/${currentFillTemplate.id}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, data }),
    });
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'No se pudo enviar el informe');

    showToast('Informe enviado.');
    closeFillReportModal();
    await loadMyReports();
  } catch (err) {
    fillReportMessage.className = 'message error';
    fillReportMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('fill-report-modal-close').addEventListener('click', closeFillReportModal);
fillReportModalBackdrop.addEventListener('click', (e) => {
  if (e.target === fillReportModalBackdrop) closeFillReportModal();
});

// ---------- Gestión de plantillas (staff) ----------

function openTemplatesModal() {
  templatesManageView.style.display = 'block';
  templateEditor.style.display = 'none';
  renderTemplatesManageList();
  templatesModalBackdrop.classList.add('open');
}

function closeTemplatesModal() {
  templatesModalBackdrop.classList.remove('open');
}

function renderTemplatesManageList() {
  if (reportTemplates.length === 0) {
    templatesManageItems.innerHTML = '<div class="staff-empty">No hay plantillas creadas todavía.</div>';
    return;
  }
  templatesManageItems.innerHTML = reportTemplates.map((t) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(t.name)}</span>
        <span class="status-pill ${t.active ? 'status-aprobado' : 'status-pendiente'}">${t.active ? 'Activa' : 'Inactiva'}</span>
      </div>
      <button class="btn btn-ghost btn-sm" data-view-submissions="${t.id}">Respuestas</button>
      <button class="btn btn-ghost btn-sm" data-edit-template="${t.id}">Editar</button>
      <button class="btn btn-danger btn-sm" data-delete-template="${t.id}">Eliminar</button>
    </div>
  `).join('');

  templatesManageItems.querySelectorAll('[data-view-submissions]').forEach((btn) => {
    btn.addEventListener('click', () => openSubmissionsModal(Number(btn.dataset.viewSubmissions)));
  });
  templatesManageItems.querySelectorAll('[data-edit-template]').forEach((btn) => {
    btn.addEventListener('click', () => openTemplateEditor(Number(btn.dataset.editTemplate)));
  });
  templatesManageItems.querySelectorAll('[data-delete-template]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta plantilla y todas sus respuestas?')) return;
      await fetch(`/api/report-templates/${btn.dataset.deleteTemplate}`, { method: 'DELETE' });
      await loadTemplates();
      renderTemplatesManageList();
      showToast('Plantilla eliminada.', 'danger');
    });
  });
}

function renderFieldEditorRows() {
  if (currentTemplateFields.length === 0) {
    templateFieldsList.innerHTML = '<div class="staff-empty">Todavía no agregaste ningún campo.</div>';
    return;
  }
  templateFieldsList.innerHTML = currentTemplateFields.map((f, i) => `
    <div class="field-row" data-index="${i}">
      <div class="row">
        <div>
          <label>Etiqueta</label>
          <input type="text" class="field-label-input" value="${escapeHtml(f.label)}" placeholder="Ej: Resumen del turno" />
        </div>
        <div>
          <label>Tipo</label>
          <select class="field-type-input">
            <option value="heading" ${f.type === 'heading' ? 'selected' : ''}>Título de sección (sin respuesta)</option>
            <option value="text" ${f.type === 'text' ? 'selected' : ''}>Texto corto</option>
            <option value="textarea" ${f.type === 'textarea' ? 'selected' : ''}>Texto largo</option>
            <option value="number" ${f.type === 'number' ? 'selected' : ''}>Número</option>
            <option value="date" ${f.type === 'date' ? 'selected' : ''}>Fecha</option>
            <option value="select" ${f.type === 'select' ? 'selected' : ''}>Opciones (elegir una)</option>
          </select>
        </div>
      </div>
      <div class="field-options-wrap" style="display:${f.type === 'select' ? 'block' : 'none'}">
        <label>Opciones <span class="hint">(separadas por coma)</span></label>
        <input type="text" class="field-options-input" value="${escapeHtml((f.options || []).join(', '))}" placeholder="Ej: Bueno, Regular, Dañado" />
      </div>
      <div class="field-row-footer">
        <label class="active-check-label" style="display:${f.type === 'heading' ? 'none' : 'flex'}"><input type="checkbox" class="field-required-input" ${f.required ? 'checked' : ''} style="width:auto" /> Obligatorio</label>
        <button type="button" class="btn btn-danger btn-sm remove-field-btn">Eliminar campo</button>
      </div>
    </div>
  `).join('');

  templateFieldsList.querySelectorAll('.field-row').forEach((rowEl) => {
    const idx = Number(rowEl.dataset.index);
    rowEl.querySelector('.field-label-input').addEventListener('input', (e) => { currentTemplateFields[idx].label = e.target.value; });
    rowEl.querySelector('.field-type-input').addEventListener('change', (e) => {
      currentTemplateFields[idx].type = e.target.value;
      rowEl.querySelector('.field-options-wrap').style.display = e.target.value === 'select' ? 'block' : 'none';
      rowEl.querySelector('.active-check-label').style.display = e.target.value === 'heading' ? 'none' : 'flex';
    });
    const optionsInput = rowEl.querySelector('.field-options-input');
    if (optionsInput) {
      optionsInput.addEventListener('input', (e) => {
        currentTemplateFields[idx].options = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
      });
    }
    rowEl.querySelector('.field-required-input').addEventListener('change', (e) => { currentTemplateFields[idx].required = e.target.checked; });
    rowEl.querySelector('.remove-field-btn').addEventListener('click', () => {
      currentTemplateFields.splice(idx, 1);
      renderFieldEditorRows();
    });
  });
}

function openTemplateEditor(templateId) {
  currentEditingTemplateId = templateId || null;
  templatesManageView.style.display = 'none';
  templateEditor.style.display = 'block';
  templateMessage.className = 'message';
  templateMessage.textContent = '';

  if (templateId) {
    const t = reportTemplates.find((x) => x.id === templateId);
    templateNameInput.value = t.name;
    templateDescriptionInput.value = t.description || '';
    currentTemplateFields = t.fields.map((f) => ({ ...f }));
    templateDepartmentField.style.display = 'none';
    templateActiveField.style.display = 'flex';
    templateActiveCheckbox.checked = !!t.active;
  } else {
    templateNameInput.value = '';
    templateDescriptionInput.value = '';
    currentTemplateFields = [];
    templateDepartmentField.style.display = scopedDepartment ? 'none' : 'block';
    templateDepartmentSelect.value = scopedDepartment || currentPersonalDeptFilter || 'sams';
    templateActiveField.style.display = 'none';
  }
  renderFieldEditorRows();
}

document.getElementById('add-field-btn').addEventListener('click', () => {
  currentTemplateFields.push({ key: `campo_${Date.now()}_${currentTemplateFields.length}`, label: '', type: 'text', required: false });
  renderFieldEditorRows();
});

document.getElementById('template-cancel-btn').addEventListener('click', () => {
  templatesManageView.style.display = 'block';
  templateEditor.style.display = 'none';
});

document.getElementById('template-save-btn').addEventListener('click', async () => {
  templateMessage.className = 'message';
  templateMessage.textContent = '';

  const name = templateNameInput.value.trim();
  const description = templateDescriptionInput.value.trim();

  if (!name) {
    templateMessage.className = 'message error';
    templateMessage.textContent = 'Ingresá un nombre para la plantilla.';
    return;
  }
  if (currentTemplateFields.length === 0) {
    templateMessage.className = 'message error';
    templateMessage.textContent = 'Agregá al menos un campo.';
    return;
  }
  for (const f of currentTemplateFields) {
    if (!f.label.trim()) {
      templateMessage.className = 'message error';
      templateMessage.textContent = 'Todos los campos necesitan una etiqueta.';
      return;
    }
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      templateMessage.className = 'message error';
      templateMessage.textContent = `El campo "${f.label}" necesita al menos una opción.`;
      return;
    }
  }

  const isEdit = !!currentEditingTemplateId;
  const body = { name, description, fields: currentTemplateFields };
  if (!isEdit) body.department = scopedDepartment || templateDepartmentSelect.value;
  else body.active = templateActiveCheckbox.checked;

  try {
    const url = isEdit ? `/api/report-templates/${currentEditingTemplateId}` : '/api/report-templates';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la plantilla');

    showToast(isEdit ? 'Plantilla actualizada.' : 'Plantilla creada.');
    await loadTemplates();
    templatesManageView.style.display = 'block';
    templateEditor.style.display = 'none';
    renderTemplatesManageList();
  } catch (err) {
    templateMessage.className = 'message error';
    templateMessage.textContent = err.message;
  }
});

document.getElementById('new-template-btn').addEventListener('click', () => openTemplateEditor(null));
manageTemplatesBtn.addEventListener('click', openTemplatesModal);
document.getElementById('templates-modal-close').addEventListener('click', closeTemplatesModal);
templatesModalBackdrop.addEventListener('click', (e) => {
  if (e.target === templatesModalBackdrop) closeTemplatesModal();
});

async function openSubmissionsModal(templateId) {
  currentSubmissionsTemplateId = templateId;
  const t = reportTemplates.find((x) => x.id === templateId);
  document.getElementById('submissions-modal-title').textContent = t ? t.name : 'Respuestas';
  document.getElementById('submissions-modal-sub').textContent = 'Informes enviados con esta plantilla.';
  submissionsListEl.innerHTML = '';
  submissionsEmptyEl.style.display = 'none';
  submissionsModalBackdrop.classList.add('open');

  const res = await fetch(`/api/report-templates/${templateId}/submissions`);
  if (!res.ok) return;
  const rows = await res.json();
  renderSubmissionsList(rows, t);
}

function renderSubmissionsList(rows, template) {
  if (rows.length === 0) {
    submissionsListEl.innerHTML = '';
    submissionsEmptyEl.style.display = 'block';
    return;
  }
  submissionsEmptyEl.style.display = 'none';
  submissionsListEl.innerHTML = rows.map((s) => `
    <div class="field-row">
      <div class="field-row-footer" style="margin-top:0;">
        <span class="staff-username">${escapeHtml(s.title || s.employee_name)}</span>
        ${reportStatusPill(s.status)}
        <span class="muted-link">${escapeHtml(s.employee_name)} · ${formatDate(s.created_at)}</span>
      </div>
      ${(template ? template.fields : []).map((f) => (f.type === 'heading'
        ? `<h3 class="modal-section-title" style="margin-top:12px;">${escapeHtml(f.label)}</h3>`
        : `
        <div class="report-field-value">
          <div class="k">${escapeHtml(f.label)}</div>
          <div class="v">${escapeHtml(String(s.data[f.key] ?? '') || '—')}</div>
        </div>
      `)).join('')}
      ${s.review_notes ? `
        <div class="report-field-value">
          <div class="k">Notas de revisión</div>
          <div class="v">${escapeHtml(s.review_notes)}</div>
        </div>
      ` : ''}
      <div class="review-decision" style="margin-top:10px;">
        <button class="btn btn-ok review-btn" data-review="${s.id}" data-status="aprobado"><span class="review-btn-icon">✓</span> Aprobar</button>
        <button class="btn btn-danger review-btn" data-review="${s.id}" data-status="rechazado"><span class="review-btn-icon">✕</span> Rechazar</button>
      </div>
      <div class="submit-row" style="margin-top:10px;">
        ${reportPdfLinks(s.id)}
        <button class="btn btn-danger btn-sm" data-delete-submission="${s.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  submissionsListEl.querySelectorAll('[data-review]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await fetch(`/api/report-submissions/${btn.dataset.review}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status }),
      });
      if (res.ok) {
        await openSubmissionsModal(currentSubmissionsTemplateId);
        loadPendingReports();
        showToast(btn.dataset.status === 'aprobado' ? 'Informe aprobado.' : 'Informe rechazado.', btn.dataset.status === 'aprobado' ? undefined : 'danger');
      } else {
        const data = await res.json();
        showToast(data.error || 'No se pudo actualizar el informe.', 'danger');
      }
    });
  });

  submissionsListEl.querySelectorAll('[data-delete-submission]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este informe enviado?')) return;
      await fetch(`/api/report-submissions/${btn.dataset.deleteSubmission}`, { method: 'DELETE' });
      await openSubmissionsModal(currentSubmissionsTemplateId);
      showToast('Informe eliminado.', 'danger');
    });
  });
}

document.getElementById('submissions-modal-close').addEventListener('click', () => {
  submissionsModalBackdrop.classList.remove('open');
});
submissionsModalBackdrop.addEventListener('click', (e) => {
  if (e.target === submissionsModalBackdrop) submissionsModalBackdrop.classList.remove('open');
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
  populateRolesChecklist(employeeDepartmentSelect.value);
});

// ---------- Roles / divisiones ----------

let employeeRoles = [];
const employeeRolesChecklist = document.getElementById('employee-roles-checklist');
const rolesBtn = document.getElementById('roles-btn');
const rolesModalBackdrop = document.getElementById('roles-modal-backdrop');
const rolesListEl = document.getElementById('roles-list');
const roleForm = document.getElementById('role-form');
const roleMessage = document.getElementById('role-message');

async function loadEmployeeRoles() {
  const res = await fetch('/api/employee-roles');
  if (!res.ok) return;
  employeeRoles = await res.json();
}

function rolesForDepartment(department) {
  return employeeRoles.filter((r) => !r.department || r.department === department);
}

// El acceso lo otorga automáticamente la división, así que solo un
// superadmin puede tildar/destildar; el resto del staff lo ve de solo lectura.
function populateRolesChecklist(department, selectedRoleIds = []) {
  const list = rolesForDepartment(department);
  if (list.length === 0) {
    employeeRolesChecklist.innerHTML = '<div class="staff-empty">No hay divisiones cargadas todavía.</div>';
    return;
  }
  employeeRolesChecklist.innerHTML = list.map((r) => `
    <label>
      <input type="checkbox" value="${r.id}" ${selectedRoleIds.includes(r.id) ? 'checked' : ''} ${isSuperadmin ? '' : 'disabled'} />
      ${escapeHtml(r.name)}
    </label>
  `).join('');
}

function getSelectedRoleIds() {
  return Array.from(employeeRolesChecklist.querySelectorAll('input[type="checkbox"]:checked')).map((c) => Number(c.value));
}

async function openRolesModal() {
  await loadEmployeeRoles();
  renderRolesList();
  roleMessage.className = 'message';
  roleMessage.textContent = '';
  roleForm.reset();
  rolesModalBackdrop.classList.add('open');
}

function roleGrantsBadge(active, label) {
  return `<span class="status-pill ${active ? 'status-aprobado' : 'status-pendiente'}">${active ? '✓ ' : ''}${label}</span>`;
}

function renderRolesList() {
  if (employeeRoles.length === 0) {
    rolesListEl.innerHTML = '<div class="staff-empty">No hay divisiones cargadas.</div>';
    return;
  }
  rolesListEl.innerHTML = employeeRoles.map((r) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(r.name)}</span>
        ${r.department ? `<span class="dept-badge dept-${r.department}">${departmentLabel(r.department)}</span>` : '<span class="dept-badge">Compartido</span>'}
        <button class="status-pill" style="border:none;cursor:pointer" data-toggle-grant="${r.id}" data-grant="grants_staff" data-value="${r.grants_staff ? '0' : '1'}">${roleGrantsBadge(!!r.grants_staff, 'Staff')}</button>
        <button class="status-pill" style="border:none;cursor:pointer" data-toggle-grant="${r.id}" data-grant="grants_superadmin" data-value="${r.grants_superadmin ? '0' : '1'}">${roleGrantsBadge(!!r.grants_superadmin, 'Superadmin')}</button>
        <button class="status-pill" style="border:none;cursor:pointer" data-toggle-grant="${r.id}" data-grant="grants_hr_access" data-value="${r.grants_hr_access ? '0' : '1'}">${roleGrantsBadge(!!r.grants_hr_access, 'Fichajes')}</button>
      </div>
      <button class="btn btn-danger btn-sm" data-delete-role="${r.id}">Eliminar</button>
    </div>
  `).join('');

  rolesListEl.querySelectorAll('[data-toggle-grant]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const grantKey = btn.dataset.grant;
      const bodyKey = { grants_staff: 'grantsStaff', grants_superadmin: 'grantsSuperadmin', grants_hr_access: 'grantsHrAccess' }[grantKey];
      const res = await fetch(`/api/employee-roles/${btn.dataset.toggleGrant}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: btn.dataset.value === '1' }),
      });
      if (res.ok) {
        await loadEmployeeRoles();
        renderRolesList();
        showToast('División actualizada.');
      } else {
        const data = await res.json();
        showToast(data.error || 'No se pudo actualizar la división.', 'danger');
      }
    });
  });

  rolesListEl.querySelectorAll('[data-delete-role]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta división? Se le va a quitar a todos los empleados que la tenían.')) return;
      await fetch(`/api/employee-roles/${btn.dataset.deleteRole}`, { method: 'DELETE' });
      await loadEmployeeRoles();
      renderRolesList();
      showToast('División eliminada.', 'danger');
    });
  });
}

function closeRolesModal() {
  rolesModalBackdrop.classList.remove('open');
}

roleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  roleMessage.className = 'message';
  roleMessage.textContent = '';

  const name = document.getElementById('role-name').value.trim();
  const department = document.getElementById('role-department').value;
  const grantsStaff = document.getElementById('role-grants-staff').checked;
  const grantsSuperadmin = document.getElementById('role-grants-superadmin').checked;
  const grantsHrAccess = document.getElementById('role-grants-hr').checked;

  try {
    const res = await fetch('/api/employee-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, department: department || undefined, grantsStaff, grantsSuperadmin, grantsHrAccess }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear la división');

    roleForm.reset();
    await loadEmployeeRoles();
    renderRolesList();
    showToast('División creada.');
  } catch (err) {
    roleMessage.className = 'message error';
    roleMessage.textContent = err.message;
  }
});

rolesBtn.addEventListener('click', openRolesModal);
document.getElementById('roles-modal-close').addEventListener('click', closeRolesModal);
rolesModalBackdrop.addEventListener('click', (e) => {
  if (e.target === rolesModalBackdrop) closeRolesModal();
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
  document.getElementById('employee-fichaje-username').value = '';
  document.getElementById('employee-fichaje-password').value = '';
  document.getElementById('employee-fichaje-message').className = 'message';
  document.getElementById('employee-fichaje-message').textContent = '';
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
  document.getElementById('employee-fichaje-section').style.display = 'none';
  employeeDepartmentField.style.display = scopedDepartment ? 'none' : 'block';

  // Si hay un filtro de departamento activo, el nuevo empleado arranca en
  // ese departamento para que aparezca en la lista apenas se crea.
  const initialDept = scopedDepartment || currentPersonalDeptFilter || 'sams';
  employeeDepartmentSelect.value = initialDept;
  populateRankSelect(initialDept);
  populateRolesChecklist(initialDept, []);

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
  document.getElementById('employee-fichaje-section').style.display = 'block';
  document.getElementById('employee-fichaje-status').textContent = e.has_login
    ? `Ya puede entrar al sistema con el usuario "${e.username}".`
    : 'Este empleado todavía no tiene cuenta para entrar al sistema.';
  document.getElementById('employee-fichaje-username').value = e.username || '';

  document.getElementById('employee-fullname').value = e.full_name;
  document.getElementById('employee-phone').value = e.phone || '';
  document.getElementById('employee-discord').value = e.discord_info || '';
  employeeActiveCheckbox.checked = !!e.active;
  populateRankSelect(e.department, e.rank_id);
  populateRolesChecklist(e.department, e.role_ids || []);

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
    // Las divisiones otorgan acceso automáticamente, así que solo se
    // mandan si quien está logueado es superadmin (el resto ni las ve
    // habilitadas para tocar).
    if (isSuperadmin) body.roleIds = getSelectedRoleIds();

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

document.getElementById('employee-fichaje-save-btn').addEventListener('click', async () => {
  if (!currentEmployeeId) return;
  const fichajeMessage = document.getElementById('employee-fichaje-message');
  fichajeMessage.className = 'message';
  fichajeMessage.textContent = '';

  const fichajeUsername = document.getElementById('employee-fichaje-username').value.trim();
  const fichajePassword = document.getElementById('employee-fichaje-password').value;

  try {
    const res = await fetch(`/api/employees/${currentEmployeeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fichajeUsername, fichajePassword: fichajePassword || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el acceso de fichaje');

    document.getElementById('employee-fichaje-password').value = '';
    await loadEmployees();
    const updated = employees.find((x) => x.id === currentEmployeeId);
    document.getElementById('employee-fichaje-status').textContent = updated && updated.has_login
      ? `Ya puede entrar al sistema con el usuario "${updated.username}".`
      : 'Este empleado todavía no tiene cuenta para entrar al sistema.';
    showToast('Cuenta de acceso actualizada.');
  } catch (err) {
    fichajeMessage.className = 'message error';
    fichajeMessage.textContent = err.message;
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
  if (rolesModalBackdrop.classList.contains('open')) closeRolesModal();
  if (inventoryModalBackdrop.classList.contains('open')) closeInventoryModal();
  if (caseModalBackdrop.classList.contains('open')) closeCaseModal();
  if (templatesModalBackdrop.classList.contains('open')) closeTemplatesModal();
  if (fillReportModalBackdrop.classList.contains('open')) closeFillReportModal();
  if (submissionsModalBackdrop.classList.contains('open')) submissionsModalBackdrop.classList.remove('open');
  if (cadetModalBackdrop.classList.contains('open')) closeCadetModal();
  if (courseModalBackdrop.classList.contains('open')) closeCourseModal();
});

// ---------- Fichajes (vista de RRHH / Dirección) ----------

let attendanceRows = [];
let currentAttendanceDeptFilter = '';
let currentAttendanceSearch = '';
let currentAttendanceFrom = '';
let currentAttendanceTo = '';

const attendanceTableBody = document.getElementById('attendance-table-body');
const attendanceEmpty = document.getElementById('attendance-empty');

async function loadAttendance() {
  const params = new URLSearchParams();
  if (currentAttendanceDeptFilter) params.set('department', currentAttendanceDeptFilter);
  if (currentAttendanceFrom) params.set('from', currentAttendanceFrom);
  if (currentAttendanceTo) params.set('to', currentAttendanceTo);
  const query = params.toString();
  const res = await fetch(query ? `/api/attendance?${query}` : '/api/attendance');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  if (res.status === 403) {
    attendanceRows = [];
    renderAttendanceStats();
    attendanceTableBody.innerHTML = '';
    attendanceEmpty.style.display = 'block';
    attendanceEmpty.querySelector('p').textContent = 'No tenés acceso para ver los fichajes del personal.';
    return;
  }
  attendanceRows = await res.json();
  renderAttendanceStats();
  renderAttendanceTable();
}

function renderAttendanceStats() {
  document.getElementById('astat-total').textContent = attendanceRows.length;
  document.getElementById('astat-active').textContent = attendanceRows.filter((a) => !a.clock_out).length;
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('astat-today').textContent = attendanceRows.filter((a) => a.clock_in.slice(0, 10) === today).length;
}

function getFilteredAttendance() {
  if (!currentAttendanceSearch) return attendanceRows;
  const term = currentAttendanceSearch.toLowerCase();
  return attendanceRows.filter((a) => a.employee_name.toLowerCase().includes(term));
}

function attendanceDuration(clockIn, clockOut) {
  const start = new Date(`${clockIn.replace(' ', 'T')}Z`);
  const end = clockOut ? new Date(`${clockOut.replace(' ', 'T')}Z`) : new Date();
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderAttendanceTable() {
  const rows = getFilteredAttendance();
  attendanceTableBody.innerHTML = '';
  if (rows.length === 0) {
    attendanceEmpty.style.display = 'block';
    attendanceEmpty.querySelector('p').textContent = 'No hay fichajes registrados en esta categoría.';
    return;
  }
  attendanceEmpty.style.display = 'none';

  for (const a of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(a.employee_name)}</td>
      <td><span class="dept-badge dept-${a.department}">${departmentLabel(a.department)}</span></td>
      <td>${formatDate(a.clock_in)}</td>
      <td>${a.clock_out ? formatDate(a.clock_out) : '<span class="status-pill status-pendiente">En curso</span>'}</td>
      <td>${attendanceDuration(a.clock_in, a.clock_out)}</td>
      <td><button class="btn btn-danger btn-sm" data-delete-attendance="${a.id}">Eliminar</button></td>
    `;
    attendanceTableBody.appendChild(tr);
  }

  attendanceTableBody.querySelectorAll('[data-delete-attendance]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este fichaje?')) return;
      await fetch(`/api/attendance/${btn.dataset.deleteAttendance}`, { method: 'DELETE' });
      await loadAttendance();
      showToast('Fichaje eliminado.', 'danger');
    });
  });
}

document.getElementById('attendance-search-input').addEventListener('input', (e) => {
  currentAttendanceSearch = e.target.value.trim();
  renderAttendanceTable();
});

document.getElementById('attendance-from-input').addEventListener('change', (e) => {
  currentAttendanceFrom = e.target.value;
  loadAttendance();
});

document.getElementById('attendance-to-input').addEventListener('change', (e) => {
  currentAttendanceTo = e.target.value;
  loadAttendance();
});

document.getElementById('attendance-date-clear-btn').addEventListener('click', () => {
  currentAttendanceFrom = '';
  currentAttendanceTo = '';
  document.getElementById('attendance-from-input').value = '';
  document.getElementById('attendance-to-input').value = '';
  loadAttendance();
});

document.querySelectorAll('.attendance-dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.attendance-dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentAttendanceDeptFilter = btn.dataset.department;
    loadAttendance();
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
  renderLowStockBanner();
  renderInventoryTable();
}

const INVENTORY_CATEGORIES = {
  sams: ['Medicamentos', 'Material de curación', 'Equipamiento médico', 'Oxígeno y respiración', 'Diagnóstico', 'Otros'],
  safd: ['Equipo contra incendios', 'Rescate y extracción', 'Protección personal', 'Herramientas', 'Comunicaciones', 'Otros'],
};

function populateInventoryCategorySelect(department, selected) {
  const select = document.getElementById('inventory-category');
  const list = INVENTORY_CATEGORIES[department] || INVENTORY_CATEGORIES.sams;
  select.innerHTML = list.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (selected && !list.includes(selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    opt.textContent = selected;
    select.appendChild(opt);
  }
  select.value = selected || list[0];
}

function renderInventoryStats() {
  document.getElementById('istat-total').textContent = inventoryItems.length;
  document.getElementById('istat-low').textContent = inventoryItems.filter((i) => i.quantity <= i.min_quantity).length;
}

function renderLowStockBanner() {
  const banner = document.getElementById('inventory-low-banner');
  const lowItems = inventoryItems.filter((i) => i.quantity <= i.min_quantity);
  if (lowItems.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.style.display = 'block';
  const names = lowItems.map((i) => `<strong>${escapeHtml(i.name)}</strong> (${i.quantity}/${i.min_quantity} ${escapeHtml(i.unit)})`).join(', ');
  banner.innerHTML = `⚠️ ${lowItems.length === 1 ? 'Hay un insumo' : `Hay ${lowItems.length} insumos`} con stock en o por debajo del mínimo: ${names}.`;
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
  populateInventoryCategorySelect(initialDept);

  inventoryModalBackdrop.classList.add('open');
}

inventoryDepartmentSelect.addEventListener('change', () => {
  populateInventoryCategorySelect(inventoryDepartmentSelect.value);
});

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
  populateInventoryCategorySelect(item.department, item.category);
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
    if (data.justWentLow) {
      showToast(`⚠️ ${item ? item.name : 'El insumo'} entró en stock bajo.`, 'danger');
    } else {
      showToast('Movimiento registrado.');
    }
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
let currentCasesFrom = '';
let currentCasesTo = '';
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
const caseInventorySection = document.getElementById('case-inventory-section');
const caseItemSelect = document.getElementById('case-item-select');
const caseItemMessage = document.getElementById('case-item-message');
const caseItemUsageList = document.getElementById('case-item-usage-list');
const caseHistorySection = document.getElementById('case-history-section');
const caseHistoryList = document.getElementById('case-history-list');

async function loadCases() {
  const params = new URLSearchParams();
  if (currentCasesDeptFilter) params.set('department', currentCasesDeptFilter);
  if (currentCasesStatusFilter) params.set('status', currentCasesStatusFilter);
  if (currentCasesFrom) params.set('from', currentCasesFrom);
  if (currentCasesTo) params.set('to', currentCasesTo);
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
  caseInventorySection.style.display = 'none';
  caseHistorySection.style.display = 'none';

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

  caseInventorySection.style.display = 'block';
  caseHistorySection.style.display = 'block';
  caseItemMessage.className = 'message';
  caseItemMessage.textContent = '';
  caseItemUsageList.innerHTML = '<div class="staff-empty">Cargando…</div>';
  caseHistoryList.innerHTML = '<div class="staff-empty">Cargando…</div>';

  caseModalBackdrop.classList.add('open');

  await Promise.all([
    loadCaseItemOptions(c.department),
    loadCaseItemUsage(id),
    loadCaseHistory(c),
  ]);
}

async function loadCaseItemOptions(department) {
  const res = await fetch(`/api/inventory?department=${department}`);
  if (!res.ok) return;
  const items = await res.json();
  caseItemSelect.innerHTML = items.length === 0
    ? '<option value="">No hay insumos cargados para este departamento</option>'
    : items.map((i) => `<option value="${i.id}">${escapeHtml(i.name)} (${i.quantity} ${escapeHtml(i.unit)} disponibles)</option>`).join('');
}

async function loadCaseItemUsage(caseId) {
  const res = await fetch(`/api/cases/${caseId}/movements`);
  if (!res.ok) return;
  const rows = await res.json();
  renderCaseItemUsage(rows);
}

function renderCaseItemUsage(rows) {
  if (rows.length === 0) {
    caseItemUsageList.innerHTML = '<div class="staff-empty">Todavía no se descontaron insumos para esta atención.</div>';
    return;
  }
  caseItemUsageList.innerHTML = rows.map((m) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="status-pill status-rechazado">-${m.quantity}</span>
        <span class="staff-username">${escapeHtml(m.item_name)}</span>
      </div>
      <span class="muted-link">${formatDate(m.created_at)}</span>
    </div>
  `).join('');
}

document.getElementById('case-item-add-btn').addEventListener('click', async () => {
  if (!currentCaseId) return;
  const itemId = caseItemSelect.value;
  const quantity = Number(document.getElementById('case-item-qty').value);
  const c = cases.find((x) => x.id === currentCaseId);

  caseItemMessage.className = 'message';
  caseItemMessage.textContent = '';

  if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
    caseItemMessage.className = 'message error';
    caseItemMessage.textContent = 'Elegí un insumo y una cantidad válida.';
    return;
  }

  try {
    const res = await fetch(`/api/inventory/${itemId}/movements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'salida',
        quantity,
        reason: `Atención #${currentCaseId} — ${c ? c.subject_name : ''}`,
        caseId: currentCaseId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo descontar el insumo');

    document.getElementById('case-item-qty').value = '';
    await loadCaseItemUsage(currentCaseId);
    if (c) await loadCaseItemOptions(c.department);
    showToast(data.justWentLow ? '⚠️ Insumo descontado. Entró en stock bajo.' : 'Insumo descontado del inventario.', data.justWentLow ? 'danger' : 'ok');
  } catch (err) {
    caseItemMessage.className = 'message error';
    caseItemMessage.textContent = err.message;
  }
});

async function loadCaseHistory(c) {
  const params = new URLSearchParams({ subject: c.subject_name, department: c.department });
  const res = await fetch(`/api/cases?${params.toString()}`);
  if (!res.ok) return;
  const rows = (await res.json()).filter((x) => x.id !== c.id);
  renderCaseHistory(rows);
}

function renderCaseHistory(rows) {
  if (rows.length === 0) {
    caseHistoryList.innerHTML = '<div class="staff-empty">No se encontraron atenciones anteriores de este paciente.</div>';
    return;
  }
  caseHistoryList.innerHTML = rows.map((c) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="status-pill ${c.status === 'abierta' ? 'status-pendiente' : 'status-aprobado'}">${c.status === 'abierta' ? 'Abierta' : 'Cerrada'}</span>
        <span class="staff-username">${escapeHtml(c.summary.slice(0, 80))}${c.summary.length > 80 ? '…' : ''}</span>
      </div>
      <span class="muted-link">${formatDate(c.created_at)}</span>
    </div>
  `).join('');
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

document.getElementById('cases-from-input').addEventListener('change', (e) => {
  currentCasesFrom = e.target.value;
  loadCases();
});

document.getElementById('cases-to-input').addEventListener('change', (e) => {
  currentCasesTo = e.target.value;
  loadCases();
});

document.getElementById('cases-date-clear-btn').addEventListener('click', () => {
  currentCasesFrom = '';
  currentCasesTo = '';
  document.getElementById('cases-from-input').value = '';
  document.getElementById('cases-to-input').value = '';
  loadCases();
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

// ---------- Academia (cadetes, cursos y evaluaciones, a cargo de RTD) ----------

let cadets = [];
let academyCourses = [];
let currentCadetsDeptFilter = '';
let currentCadetsStatusFilter = '';
let currentCadetsSearch = '';
let currentCadetId = null;
let currentCourseId = null;

const cadetsListEl = document.getElementById('cadets-list');
const cadetsEmptyEl = document.getElementById('cadets-empty');
const cadetModalBackdrop = document.getElementById('cadet-modal-backdrop');
const cadetForm = document.getElementById('cadet-form');
const cadetMessage = document.getElementById('cadet-message');
const cadetDepartmentField = document.getElementById('cadet-department-field');
const cadetDepartmentSelect = document.getElementById('cadet-department');
const cadetStatusField = document.getElementById('cadet-status-field');
const cadetStatusSelect = document.getElementById('cadet-status');
const cadetFormSubmit = document.getElementById('cadet-form-submit');
const cadetDeleteBtn = document.getElementById('cadet-delete-btn');
const cadetAccessSection = document.getElementById('cadet-access-section');
const cadetGraduateSection = document.getElementById('cadet-graduate-section');
const cadetNotesSection = document.getElementById('cadet-notes-section');
const cadetNotesListEl = document.getElementById('cadet-notes-list');
const evaluationsListEl = document.getElementById('evaluations-list');
const evaluationsEmptyEl = document.getElementById('evaluations-empty');
const evaluationCadetSelect = document.getElementById('evaluation-cadet-select');
let currentEvalDeptFilter = '';
const coursesListEl = document.getElementById('courses-list');
const coursesEmptyEl = document.getElementById('courses-empty');
const courseModalBackdrop = document.getElementById('course-modal-backdrop');
const courseForm = document.getElementById('course-form');
const courseMessage = document.getElementById('course-message');
const courseDepartmentField = document.getElementById('course-department-field');
const courseFormSubmit = document.getElementById('course-form-submit');
const courseDeleteBtn = document.getElementById('course-delete-btn');
const courseActiveField = document.getElementById('course-active-field');
const classesListEl = document.getElementById('classes-list');
const materialsListEl = document.getElementById('materials-list');
const examsListEl = document.getElementById('exams-list');
const examsEmptyEl = document.getElementById('exams-empty');
const examsListView = document.getElementById('exams-list-view');
const examEditorView = document.getElementById('exam-editor-view');
const examSubmissionsView = document.getElementById('exam-submissions-view');
const examQuestionsListEl = document.getElementById('exam-questions-list');
const examActiveField = document.getElementById('exam-active-field');
const examSubmissionsListEl = document.getElementById('exam-submissions-list');
const examSubmissionsEmptyEl = document.getElementById('exam-submissions-empty');
let exams = [];
let currentExamQuestions = [];
let currentEditingExamId = null;
let currentViewingExamId = null;

// ---- Sub-pestañas dentro del modal de curso (Información / Materiales /
// Clases / Exámenes) — antes todo vivía apilado en una sola pantalla larga. ----

function switchCourseSubtab(tab) {
  document.querySelectorAll('.course-modal-subtab-btn').forEach((b) => b.classList.toggle('active', b.dataset.courseSubtab === tab));
  ['info', 'materiales', 'clases', 'examenes'].forEach((t) => {
    document.getElementById(`course-subtab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'examenes' && currentCourseId) {
    showExamsListView();
    loadExams(currentCourseId);
  }
}

document.querySelectorAll('.course-modal-subtab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchCourseSubtab(btn.dataset.courseSubtab));
});

document.querySelectorAll('.academia-subtab-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.academia-subtab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const subtab = btn.dataset.subtab;
    document.getElementById('academia-cadetes-panel').style.display = subtab === 'cadetes' ? 'block' : 'none';
    document.getElementById('academia-cursos-panel').style.display = subtab === 'cursos' ? 'block' : 'none';
    document.getElementById('academia-evaluaciones-panel').style.display = subtab === 'evaluaciones' ? 'block' : 'none';

    if (subtab === 'cursos' && academyCourses.length === 0) await loadAcademyCourses();
    if (subtab === 'evaluaciones') {
      if (cadets.length === 0) await loadCadets();
      if (academyCourses.length === 0) await loadAcademyCourses();
      populateEvaluationCadetSelect();
      await loadAllEvaluations();
    }
  });
});

async function loadCadets() {
  const params = new URLSearchParams();
  if (currentCadetsDeptFilter) params.set('department', currentCadetsDeptFilter);
  if (currentCadetsStatusFilter) params.set('status', currentCadetsStatusFilter);
  const query = params.toString();
  const res = await fetch(query ? `/api/cadets?${query}` : '/api/cadets');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  cadets = await res.json();
  renderAcademyStats();
  renderCadetsList();
}

function renderAcademyStats() {
  document.getElementById('acstat-total').textContent = cadets.length;
  document.getElementById('acstat-activos').textContent = cadets.filter((c) => c.status === 'activo').length;
  document.getElementById('acstat-graduados').textContent = cadets.filter((c) => c.status === 'graduado').length;
}

function cadetStatusPill(status) {
  return `<span class="status-pill ${CADET_STATUS_PILL_CLASS[status] || 'status-pendiente'}">${CADET_STATUS_LABELS[status] || status}</span>`;
}

function getFilteredCadets() {
  if (!currentCadetsSearch) return cadets;
  const term = currentCadetsSearch.toLowerCase();
  return cadets.filter((c) => c.full_name.toLowerCase().includes(term));
}

function renderCadetsList() {
  const rows = getFilteredCadets();
  if (rows.length === 0) {
    cadetsListEl.innerHTML = '';
    cadetsEmptyEl.style.display = 'block';
    return;
  }
  cadetsEmptyEl.style.display = 'none';
  cadetsListEl.innerHTML = rows.map((c) => `
    <div class="staff-row row-link" data-cadet-id="${c.id}">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(c.full_name)}</span>
        <span class="dept-badge dept-${c.department}">${departmentLabel(c.department)}</span>
        ${cadetStatusPill(c.status)}
        ${c.employee_name ? `<span class="muted-link">Empleado: ${escapeHtml(c.employee_name)}</span>` : ''}
      </div>
      <span class="muted-link">Ingresó el ${formatDate(c.created_at)}</span>
    </div>
  `).join('');

  cadetsListEl.querySelectorAll('[data-cadet-id]').forEach((row) => {
    row.addEventListener('click', () => openCadetModal(Number(row.dataset.cadetId)));
  });
}

function resetCadetForm() {
  cadetForm.reset();
  cadetMessage.className = 'message';
  cadetMessage.textContent = '';
  document.getElementById('cadet-access-username').value = '';
  document.getElementById('cadet-access-password').value = '';
  document.getElementById('cadet-access-message').className = 'message';
  document.getElementById('cadet-access-message').textContent = '';
}

function openNewCadetModal() {
  currentCadetId = null;
  resetCadetForm();

  document.getElementById('cadet-modal-name').textContent = 'Nuevo estudiante';
  document.getElementById('cadet-modal-sub').textContent = 'Registrar un nuevo ingreso a la academia.';
  document.getElementById('cadet-modal-department').innerHTML = '';
  document.getElementById('cadet-modal-status').innerHTML = '';
  cadetFormSubmit.textContent = 'Registrar estudiante';
  cadetDeleteBtn.style.display = 'none';
  cadetStatusField.style.display = 'none';
  cadetAccessSection.style.display = 'none';
  cadetGraduateSection.style.display = 'none';
  cadetNotesSection.style.display = 'none';
  cadetDepartmentField.style.display = scopedDepartment ? 'none' : 'block';
  cadetDepartmentSelect.value = scopedDepartment || currentCadetsDeptFilter || 'sams';

  cadetModalBackdrop.classList.add('open');
}

async function openCadetModal(id) {
  const c = cadets.find((x) => x.id === id);
  if (!c) return;
  currentCadetId = id;
  resetCadetForm();

  document.getElementById('cadet-modal-name').textContent = c.full_name;
  document.getElementById('cadet-modal-sub').textContent = `Ingresó el ${formatDate(c.created_at)}`;
  document.getElementById('cadet-modal-department').innerHTML = `<span class="dept-badge dept-${c.department}">${departmentLabel(c.department)}</span>`;
  document.getElementById('cadet-modal-status').innerHTML = cadetStatusPill(c.status);
  cadetFormSubmit.textContent = 'Guardar cambios';
  cadetDeleteBtn.style.display = 'inline-flex';
  cadetStatusField.style.display = 'block';
  cadetDepartmentField.style.display = 'none';
  cadetAccessSection.style.display = 'block';
  cadetNotesSection.style.display = 'block';

  document.getElementById('cadet-fullname').value = c.full_name;
  document.getElementById('cadet-phone').value = c.phone || '';
  document.getElementById('cadet-discord').value = c.discord_info || '';
  document.getElementById('cadet-notes').value = c.notes || '';
  cadetStatusSelect.value = c.status;

  document.getElementById('cadet-access-status').textContent = c.username
    ? `Ya puede entrar al portal con el usuario "${c.username}".`
    : 'Este estudiante todavía no tiene cuenta para entrar al portal.';
  document.getElementById('cadet-access-username').value = c.username || '';

  cadetGraduateSection.style.display = 'block';
  document.getElementById('cadet-graduate-message').className = 'message';
  document.getElementById('cadet-graduate-message').textContent = '';
  const graduateBtn = document.getElementById('cadet-graduate-btn');
  if (c.employee_id) {
    document.getElementById('cadet-graduate-status').textContent = `Ya tiene una cuenta de empleado vinculada: ${c.employee_name || ''}.`;
    graduateBtn.style.display = 'none';
  } else {
    document.getElementById('cadet-graduate-status').textContent = 'Al graduarlo se crea automáticamente su cuenta de empleado con el rango de entrada del departamento.';
    graduateBtn.style.display = 'inline-flex';
  }

  cadetNotesListEl.innerHTML = '<div class="staff-empty">Cargando…</div>';

  cadetModalBackdrop.classList.add('open');

  await loadCadetNotes(id);
}

function closeCadetModal() {
  cadetModalBackdrop.classList.remove('open');
  currentCadetId = null;
}

cadetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  cadetMessage.className = 'message';
  cadetMessage.textContent = '';

  const isEdit = !!currentCadetId;
  const body = {
    fullName: document.getElementById('cadet-fullname').value.trim(),
    phone: document.getElementById('cadet-phone').value.trim(),
    discordInfo: document.getElementById('cadet-discord').value.trim(),
    notes: document.getElementById('cadet-notes').value.trim(),
  };
  if (!isEdit) {
    body.department = scopedDepartment || cadetDepartmentSelect.value;
  } else {
    body.status = cadetStatusSelect.value;
  }

  const submitBtn = cadetFormSubmit;
  submitBtn.disabled = true;
  try {
    const url = isEdit ? `/api/cadets/${currentCadetId}` : '/api/cadets';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el estudiante');

    showToast(isEdit ? 'Estudiante actualizado.' : 'Estudiante registrado.');
    await loadCadets();
    if (isEdit) {
      await openCadetModal(currentCadetId);
    } else {
      closeCadetModal();
    }
  } catch (err) {
    cadetMessage.className = 'message error';
    cadetMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('cadet-access-save-btn').addEventListener('click', async () => {
  if (!currentCadetId) return;
  const msg = document.getElementById('cadet-access-message');
  msg.className = 'message';
  msg.textContent = '';

  const studentUsername = document.getElementById('cadet-access-username').value.trim();
  const studentPassword = document.getElementById('cadet-access-password').value;

  try {
    const res = await fetch(`/api/cadets/${currentCadetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentUsername, studentPassword: studentPassword || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el acceso');

    document.getElementById('cadet-access-password').value = '';
    await loadCadets();
    const updated = cadets.find((x) => x.id === currentCadetId);
    document.getElementById('cadet-access-status').textContent = updated && updated.username
      ? `Ya puede entrar al portal con el usuario "${updated.username}".`
      : 'Este estudiante todavía no tiene cuenta para entrar al portal.';
    showToast('Cuenta de acceso actualizada.');
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  }
});

document.getElementById('cadet-graduate-btn').addEventListener('click', async () => {
  if (!currentCadetId) return;
  const msg = document.getElementById('cadet-graduate-message');
  msg.className = 'message';
  msg.textContent = '';
  try {
    const res = await fetch(`/api/cadets/${currentCadetId}/graduate`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo graduar al estudiante');

    showToast('Estudiante graduado. Se creó su cuenta de empleado.');
    await loadCadets();
    await openCadetModal(currentCadetId);
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  }
});

cadetDeleteBtn.addEventListener('click', async () => {
  if (!currentCadetId) return;
  if (!confirm('¿Eliminar este estudiante y todo su historial de formación?')) return;
  await fetch(`/api/cadets/${currentCadetId}`, { method: 'DELETE' });
  closeCadetModal();
  await loadCadets();
  showToast('Estudiante eliminado.', 'danger');
});

document.getElementById('new-cadet-btn').addEventListener('click', openNewCadetModal);
document.getElementById('cadet-modal-close').addEventListener('click', closeCadetModal);
cadetModalBackdrop.addEventListener('click', (e) => {
  if (e.target === cadetModalBackdrop) closeCadetModal();
});

document.getElementById('cadets-search-input').addEventListener('input', (e) => {
  currentCadetsSearch = e.target.value.trim();
  renderCadetsList();
});

document.querySelectorAll('.academia-dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.academia-dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentCadetsDeptFilter = btn.dataset.department;
    loadCadets();
  });
});

document.querySelectorAll('.academia-status-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.academia-status-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentCadetsStatusFilter = btn.dataset.status;
    loadCadets();
  });
});

// ---- Evaluaciones (sección propia de la Academia, no dentro del modal
// de cada cadete: se ven y se cargan todas juntas desde acá) ----

function populateEvaluationCadetSelect() {
  const list = currentEvalDeptFilter ? cadets.filter((c) => c.department === currentEvalDeptFilter) : cadets;
  evaluationCadetSelect.innerHTML = list.length === 0
    ? '<option value="">No hay estudiantes cargados</option>'
    : list.map((c) => `<option value="${c.id}" data-department="${c.department}">${escapeHtml(c.full_name)} (${departmentLabel(c.department)})</option>`).join('');
  populateEvaluationCourseSelect(list[0] ? list[0].department : null);
}

function populateEvaluationCourseSelect(department) {
  const select = document.getElementById('evaluation-course');
  const list = department ? academyCourses.filter((c) => !c.department || c.department === department) : academyCourses;
  select.innerHTML = '<option value="">Sin curso asociado</option>' + list.map((c) => (
    `<option value="${c.id}">${escapeHtml(c.name)}</option>`
  )).join('');
}

evaluationCadetSelect.addEventListener('change', () => {
  const opt = evaluationCadetSelect.selectedOptions[0];
  populateEvaluationCourseSelect(opt ? opt.dataset.department : null);
});

async function loadAllEvaluations() {
  const params = new URLSearchParams();
  if (currentEvalDeptFilter) params.set('department', currentEvalDeptFilter);
  const query = params.toString();
  const res = await fetch(query ? `/api/academy-evaluations?${query}` : '/api/academy-evaluations');
  if (!res.ok) return;
  const rows = await res.json();
  renderEvaluations(rows);
}

function renderEvaluations(rows) {
  if (rows.length === 0) {
    evaluationsListEl.innerHTML = '';
    evaluationsEmptyEl.style.display = 'block';
    return;
  }
  evaluationsEmptyEl.style.display = 'none';
  evaluationsListEl.innerHTML = rows.map((ev) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(ev.title)}</span>
        <span class="dept-badge dept-${ev.cadet_department}">${escapeHtml(ev.cadet_name)}</span>
        ${ev.course_name ? `<span class="muted-link">${escapeHtml(ev.course_name)}</span>` : ''}
        ${ev.score !== null && ev.score !== undefined ? `<span class="status-pill status-pendiente">${ev.score}/${ev.max_score}</span>` : ''}
        ${ev.passed === 1 ? '<span class="status-pill status-aprobado">Aprobado</span>' : ev.passed === 0 ? '<span class="status-pill status-rechazado">Reprobado</span>' : ''}
        <span class="muted-link">${formatDate(ev.created_at)}</span>
      </div>
      <button class="btn btn-danger btn-sm" data-delete-evaluation="${ev.id}">Eliminar</button>
    </div>
  `).join('');

  evaluationsListEl.querySelectorAll('[data-delete-evaluation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta evaluación?')) return;
      await fetch(`/api/academy-evaluations/${btn.dataset.deleteEvaluation}`, { method: 'DELETE' });
      await loadAllEvaluations();
      showToast('Evaluación eliminada.', 'danger');
    });
  });
}

document.querySelectorAll('.academia-eval-dept-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.academia-eval-dept-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentEvalDeptFilter = btn.dataset.department;
    populateEvaluationCadetSelect();
    loadAllEvaluations();
  });
});

document.getElementById('evaluation-add-btn').addEventListener('click', async () => {
  const cadetId = evaluationCadetSelect.value;
  const msg = document.getElementById('evaluation-message');
  msg.className = 'message';
  msg.textContent = '';

  if (!cadetId) {
    msg.className = 'message error';
    msg.textContent = 'Elegí un estudiante.';
    return;
  }

  const title = document.getElementById('evaluation-title').value.trim();
  const courseId = document.getElementById('evaluation-course').value || undefined;
  const score = document.getElementById('evaluation-score').value;
  const maxScore = document.getElementById('evaluation-max-score').value;
  const passedRaw = document.getElementById('evaluation-passed').value;
  const notes = document.getElementById('evaluation-notes').value.trim();

  if (!title) {
    msg.className = 'message error';
    msg.textContent = 'Ponele un título a la evaluación.';
    return;
  }

  try {
    const res = await fetch(`/api/cadets/${cadetId}/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, courseId, score: score || undefined, maxScore: maxScore || undefined,
        passed: passedRaw === '' ? undefined : passedRaw === '1', notes,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo registrar la evaluación');

    document.getElementById('evaluation-title').value = '';
    document.getElementById('evaluation-score').value = '';
    document.getElementById('evaluation-notes').value = '';
    document.getElementById('evaluation-passed').value = '';
    await loadAllEvaluations();
    showToast('Evaluación registrada.');
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  }
});

// ---- Informes de seguimiento ----

async function loadCadetNotes(cadetId) {
  const res = await fetch(`/api/cadets/${cadetId}/notes`);
  if (!res.ok) return;
  const rows = await res.json();
  renderCadetNotes(rows);
}

function renderCadetNotes(rows) {
  if (rows.length === 0) {
    cadetNotesListEl.innerHTML = '<div class="staff-empty">Todavía no hay informes de seguimiento.</div>';
    return;
  }
  cadetNotesListEl.innerHTML = rows.map((n) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(n.author_name || 'Staff')}</span>
        <span class="muted-link">${formatDate(n.created_at)}</span>
        <div class="muted-link" style="flex-basis:100%; white-space:pre-wrap;">${escapeHtml(n.body)}</div>
      </div>
      <button class="btn btn-danger btn-sm" data-delete-note="${n.id}">Eliminar</button>
    </div>
  `).join('');

  cadetNotesListEl.querySelectorAll('[data-delete-note]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este informe de seguimiento?')) return;
      await fetch(`/api/cadet-notes/${btn.dataset.deleteNote}`, { method: 'DELETE' });
      await loadCadetNotes(currentCadetId);
      showToast('Informe eliminado.', 'danger');
    });
  });
}

document.getElementById('cadet-note-add-btn').addEventListener('click', async () => {
  if (!currentCadetId) return;
  const msg = document.getElementById('cadet-note-message');
  msg.className = 'message';
  msg.textContent = '';

  const body = document.getElementById('cadet-note-body').value.trim();
  if (!body) {
    msg.className = 'message error';
    msg.textContent = 'Escribí algo antes de agregar el informe.';
    return;
  }

  try {
    const res = await fetch(`/api/cadets/${currentCadetId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo agregar el informe');

    document.getElementById('cadet-note-body').value = '';
    await loadCadetNotes(currentCadetId);
    showToast('Informe agregado.');
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  }
});

// ---- Cursos y clases ----

async function loadAcademyCourses() {
  const res = await fetch('/api/academy-courses');
  if (!res.ok) return;
  academyCourses = await res.json();
  renderCoursesList();
}

function renderCoursesList() {
  if (academyCourses.length === 0) {
    coursesListEl.innerHTML = '';
    coursesEmptyEl.style.display = 'block';
    return;
  }
  coursesEmptyEl.style.display = 'none';
  coursesListEl.innerHTML = academyCourses.map((c) => `
    <div class="staff-row row-link" data-course-id="${c.id}">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(c.name)}</span>
        ${c.department ? `<span class="dept-badge dept-${c.department}">${departmentLabel(c.department)}</span>` : '<span class="dept-badge">Compartido</span>'}
        <span class="status-pill ${c.active ? 'status-aprobado' : 'status-baja'}">${c.active ? 'Activo' : 'Inactivo'}</span>
      </div>
      <span class="row-chevron">›</span>
    </div>
  `).join('');

  coursesListEl.querySelectorAll('[data-course-id]').forEach((row) => {
    row.addEventListener('click', () => openCourseModal(Number(row.dataset.courseId)));
  });
}

function resetCourseForm() {
  courseForm.reset();
  courseMessage.className = 'message';
  courseMessage.textContent = '';
}

function openNewCourseModal() {
  currentCourseId = null;
  resetCourseForm();

  document.getElementById('course-modal-title').textContent = 'Nuevo curso';
  document.getElementById('course-modal-sub').textContent = '';
  courseFormSubmit.textContent = 'Crear curso';
  courseDeleteBtn.style.display = 'none';
  courseActiveField.style.display = 'none';
  document.getElementById('course-subtab-materiales-btn').style.display = 'none';
  document.getElementById('course-subtab-clases-btn').style.display = 'none';
  document.getElementById('course-subtab-examenes-btn').style.display = 'none';
  switchCourseSubtab('info');
  courseDepartmentField.style.display = scopedDepartment ? 'none' : 'block';

  courseModalBackdrop.classList.add('open');
}

async function openCourseModal(id) {
  const c = academyCourses.find((x) => x.id === id);
  if (!c) return;
  currentCourseId = id;
  resetCourseForm();

  document.getElementById('course-modal-title').textContent = c.name;
  document.getElementById('course-modal-sub').textContent = c.department ? departmentLabel(c.department) : 'Compartido (SAMS y SAFD)';
  courseFormSubmit.textContent = 'Guardar cambios';
  courseDeleteBtn.style.display = 'inline-flex';
  courseActiveField.style.display = 'flex';
  courseDepartmentField.style.display = 'none';
  document.getElementById('course-subtab-materiales-btn').style.display = '';
  document.getElementById('course-subtab-clases-btn').style.display = '';
  document.getElementById('course-subtab-examenes-btn').style.display = '';
  switchCourseSubtab('info');

  document.getElementById('course-name').value = c.name;
  document.getElementById('course-description').value = c.description || '';
  document.getElementById('course-active').checked = !!c.active;

  populateClassInstructorSelect(c.department);
  classesListEl.innerHTML = '<div class="staff-empty">Cargando…</div>';
  materialsListEl.innerHTML = '<div class="staff-empty">Cargando…</div>';
  document.getElementById('material-file-input').value = '';
  document.getElementById('material-message').className = 'message';
  document.getElementById('material-message').textContent = '';
  courseModalBackdrop.classList.add('open');

  await Promise.all([loadClasses(id), loadMaterials(id)]);
}

function closeCourseModal() {
  courseModalBackdrop.classList.remove('open');
  currentCourseId = null;
}

courseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  courseMessage.className = 'message';
  courseMessage.textContent = '';

  const isEdit = !!currentCourseId;
  const body = {
    name: document.getElementById('course-name').value.trim(),
    description: document.getElementById('course-description').value.trim(),
  };
  if (!isEdit) {
    body.department = document.getElementById('course-department').value || undefined;
  } else {
    body.active = document.getElementById('course-active').checked;
  }

  const submitBtn = courseFormSubmit;
  submitBtn.disabled = true;
  try {
    const url = isEdit ? `/api/academy-courses/${currentCourseId}` : '/api/academy-courses';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el curso');

    showToast(isEdit ? 'Curso actualizado.' : 'Curso creado.');
    await loadAcademyCourses();
    // Al crear un curso nuevo, en vez de cerrar el modal lo dejamos abierto
    // ya directamente en modo edición: ahí es donde vive "Materiales del
    // curso" y "Clases programadas", así que si se cerraba de una el
    // usuario no encontraba dónde subir el primer archivo.
    await openCourseModal(isEdit ? currentCourseId : data.id);
  } catch (err) {
    courseMessage.className = 'message error';
    courseMessage.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

courseDeleteBtn.addEventListener('click', async () => {
  if (!currentCourseId) return;
  if (!confirm('¿Eliminar este curso y sus clases programadas?')) return;
  try {
    const res = await fetch(`/api/academy-courses/${currentCourseId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo eliminar el curso.');
    }
    closeCourseModal();
    await loadAcademyCourses();
    showToast('Curso eliminado.', 'danger');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('new-course-btn').addEventListener('click', openNewCourseModal);
document.getElementById('course-modal-close').addEventListener('click', closeCourseModal);
courseModalBackdrop.addEventListener('click', (e) => {
  if (e.target === courseModalBackdrop) closeCourseModal();
});

function populateClassInstructorSelect(department) {
  const select = document.getElementById('class-instructor');
  const list = department ? employees.filter((e) => e.department === department && e.active) : employees.filter((e) => e.active);
  select.innerHTML = '<option value="">Sin asignar</option>' + list.map((e) => (
    `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`
  )).join('');
}

async function loadClasses(courseId) {
  const res = await fetch(`/api/academy-courses/${courseId}/classes`);
  if (!res.ok) return;
  const rows = await res.json();
  renderClasses(rows);
}

function renderClasses(rows) {
  if (rows.length === 0) {
    classesListEl.innerHTML = '<div class="staff-empty">Todavía no hay clases programadas.</div>';
    return;
  }
  classesListEl.innerHTML = rows.map((cl) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(cl.title)}</span>
        ${cl.scheduled_at ? `<span class="muted-link">${formatDate(cl.scheduled_at)}</span>` : '<span class="muted-link">Sin fecha</span>'}
        ${cl.instructor_name ? `<span class="dept-badge">Instructor: ${escapeHtml(cl.instructor_name)}</span>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" data-delete-class="${cl.id}">Eliminar</button>
    </div>
  `).join('');

  classesListEl.querySelectorAll('[data-delete-class]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta clase?')) return;
      await fetch(`/api/academy-classes/${btn.dataset.deleteClass}`, { method: 'DELETE' });
      await loadClasses(currentCourseId);
      showToast('Clase eliminada.', 'danger');
    });
  });
}

document.getElementById('class-add-btn').addEventListener('click', async () => {
  if (!currentCourseId) return;
  const msg = document.getElementById('class-message');
  msg.className = 'message';
  msg.textContent = '';

  const title = document.getElementById('class-title').value.trim();
  const scheduledAt = document.getElementById('class-scheduled-at').value;
  const instructorEmployeeId = document.getElementById('class-instructor').value || undefined;
  const notes = document.getElementById('class-notes').value.trim();

  if (!title) {
    msg.className = 'message error';
    msg.textContent = 'Ponele un título a la clase.';
    return;
  }

  try {
    const res = await fetch(`/api/academy-courses/${currentCourseId}/classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, scheduledAt: scheduledAt || undefined, instructorEmployeeId, notes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo agregar la clase');

    document.getElementById('class-title').value = '';
    document.getElementById('class-scheduled-at').value = '';
    document.getElementById('class-notes').value = '';
    await loadClasses(currentCourseId);
    showToast('Clase agregada.');
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  }
});

// ---- Materiales del curso (presentaciones, PDFs, etc.) ----

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadMaterials(courseId) {
  const res = await fetch(`/api/academy-courses/${courseId}/materials`);
  if (!res.ok) return;
  const rows = await res.json();
  renderMaterials(rows);
}

function renderMaterials(rows) {
  if (rows.length === 0) {
    materialsListEl.innerHTML = '<div class="staff-empty">Todavía no hay materiales cargados para este curso.</div>';
    return;
  }
  materialsListEl.innerHTML = rows.map((m) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">📄 ${escapeHtml(m.file_name)}</span>
        <span class="muted-link">${formatBytes(m.file_size)} · ${formatDate(m.created_at)}</span>
      </div>
      <a class="btn btn-primary btn-sm" href="/api/academy-materials/${m.id}/download" target="_blank" rel="noopener">Ver</a>
      <a class="btn btn-ghost btn-sm" href="/api/academy-materials/${m.id}/download?download=1">Descargar</a>
      <button class="btn btn-danger btn-sm" data-delete-material="${m.id}">Eliminar</button>
    </div>
  `).join('');

  materialsListEl.querySelectorAll('[data-delete-material]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este material?')) return;
      await fetch(`/api/academy-materials/${btn.dataset.deleteMaterial}`, { method: 'DELETE' });
      await loadMaterials(currentCourseId);
      showToast('Material eliminado.', 'danger');
    });
  });
}

const MATERIAL_MAX_BYTES = 3 * 1024 * 1024;

document.getElementById('material-upload-btn').addEventListener('click', async () => {
  if (!currentCourseId) return;
  const msg = document.getElementById('material-message');
  msg.className = 'message';
  msg.textContent = '';

  const fileInput = document.getElementById('material-file-input');
  const file = fileInput.files[0];
  if (!file) {
    msg.className = 'message error';
    msg.textContent = 'Elegí un archivo primero.';
    return;
  }
  if (file.size > MATERIAL_MAX_BYTES) {
    msg.className = 'message error';
    msg.textContent = `Ese archivo pesa ${(file.size / (1024 * 1024)).toFixed(1)}MB, el máximo es 3MB.`;
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  const uploadBtn = document.getElementById('material-upload-btn');
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Subiendo...';
  try {
    const res = await fetch(`/api/academy-courses/${currentCourseId}/materials`, {
      method: 'POST',
      body: formData,
    });
    // Si el servidor devuelve algo que no sea JSON (ej: una página de
    // error del hosting ante un request rechazado antes de llegar a la
    // app), evitamos que eso se vea como un error críptico de parseo.
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('El servidor no devolvió una respuesta válida. Probá con un archivo más chico.');
    }
    if (!res.ok) throw new Error(data.error || 'No se pudo subir el archivo');

    fileInput.value = '';
    await loadMaterials(currentCourseId);
    showToast('Material subido.');
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Subir material';
  }
});

// ---- Exámenes de un curso ----

function showExamsListView() {
  examsListView.style.display = 'block';
  examEditorView.style.display = 'none';
  examSubmissionsView.style.display = 'none';
}
function showExamEditorView() {
  examsListView.style.display = 'none';
  examEditorView.style.display = 'block';
  examSubmissionsView.style.display = 'none';
}
function showExamSubmissionsView() {
  examsListView.style.display = 'none';
  examEditorView.style.display = 'none';
  examSubmissionsView.style.display = 'block';
}

async function loadExams(courseId) {
  const res = await fetch(`/api/academy-courses/${courseId}/exams`);
  if (!res.ok) return;
  exams = await res.json();
  renderExamsList();
}

function renderExamsList() {
  if (exams.length === 0) {
    examsListEl.innerHTML = '';
    examsEmptyEl.style.display = 'block';
    return;
  }
  examsEmptyEl.style.display = 'none';
  examsListEl.innerHTML = exams.map((e) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(e.title)}</span>
        <span class="status-pill ${e.active ? 'status-aprobado' : 'status-baja'}">${e.active ? 'Activo' : 'Inactivo'}</span>
        <span class="muted-link">${e.question_count} pregunta${e.question_count === 1 ? '' : 's'} · ${e.submission_count} entrega${e.submission_count === 1 ? '' : 's'}${e.pending_count > 0 ? ` · ${e.pending_count} por corregir` : ''}</span>
      </div>
      <button class="btn btn-ghost btn-sm" data-view-exam-submissions="${e.id}">Ver entregas</button>
      <button class="btn btn-ghost btn-sm" data-edit-exam="${e.id}">Editar</button>
      <button class="btn btn-danger btn-sm" data-delete-exam="${e.id}">Eliminar</button>
    </div>
  `).join('');

  examsListEl.querySelectorAll('[data-view-exam-submissions]').forEach((btn) => {
    btn.addEventListener('click', () => openExamSubmissions(Number(btn.dataset.viewExamSubmissions)));
  });
  examsListEl.querySelectorAll('[data-edit-exam]').forEach((btn) => {
    btn.addEventListener('click', () => openExamEditor(Number(btn.dataset.editExam)));
  });
  examsListEl.querySelectorAll('[data-delete-exam]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este examen y todas sus entregas?')) return;
      await fetch(`/api/academy-exams/${btn.dataset.deleteExam}`, { method: 'DELETE' });
      await loadExams(currentCourseId);
      showToast('Examen eliminado.', 'danger');
    });
  });
}

function resetExamForm() {
  document.getElementById('exam-title').value = '';
  document.getElementById('exam-description').value = '';
  document.getElementById('exam-passing-percent').value = '60';
  document.getElementById('exam-active').checked = true;
  document.getElementById('exam-message').className = 'message';
  document.getElementById('exam-message').textContent = '';
  currentExamQuestions = [];
}

function openNewExamEditor() {
  currentEditingExamId = null;
  resetExamForm();
  examActiveField.style.display = 'none';
  document.getElementById('exam-save-btn').textContent = 'Guardar examen';
  renderExamQuestionRows();
  showExamEditorView();
}

async function openExamEditor(examId) {
  currentEditingExamId = examId;
  resetExamForm();
  const res = await fetch(`/api/academy-exams/${examId}`);
  const exam = await res.json();

  document.getElementById('exam-title').value = exam.title;
  document.getElementById('exam-description').value = exam.description || '';
  document.getElementById('exam-passing-percent').value = exam.passing_percent;
  document.getElementById('exam-active').checked = !!exam.active;
  examActiveField.style.display = 'flex';
  document.getElementById('exam-save-btn').textContent = 'Guardar cambios';

  currentExamQuestions = exam.questions.map((q) => ({
    type: q.type, prompt: q.prompt, points: q.points,
    options: q.options ? [...q.options] : (q.type === 'true_false' ? ['Verdadero', 'Falso'] : q.type === 'multiple_choice' ? ['', ''] : null),
    correctOption: q.correct_option,
  }));
  renderExamQuestionRows();
  showExamEditorView();
}

function questionOptionRowHtml(opt, oi, correctOption, type, qIndex) {
  const checked = Number(correctOption) === oi ? 'checked' : '';
  if (type === 'true_false') {
    return `
      <div class="question-option-row">
        <input type="radio" name="correct-${qIndex}" class="question-option-correct" data-option-index="${oi}" ${checked} />
        <span>${oi === 0 ? 'Verdadero' : 'Falso'}</span>
      </div>
    `;
  }
  return `
    <div class="question-option-row">
      <input type="radio" name="correct-${qIndex}" class="question-option-correct" data-option-index="${oi}" ${checked} />
      <input type="text" class="question-option-text" value="${escapeHtml(opt)}" placeholder="Opción ${oi + 1}" />
      <button type="button" class="btn btn-danger btn-sm remove-option-btn">×</button>
    </div>
  `;
}

function renderExamQuestionRows() {
  if (currentExamQuestions.length === 0) {
    examQuestionsListEl.innerHTML = '<div class="staff-empty">Todavía no agregaste ninguna pregunta.</div>';
    return;
  }
  examQuestionsListEl.innerHTML = currentExamQuestions.map((q, i) => `
    <div class="field-row" data-index="${i}">
      <div class="row">
        <div>
          <label>Enunciado</label>
          <input type="text" class="question-prompt-input" value="${escapeHtml(q.prompt)}" placeholder="Ej: ¿Cuál es la dosis correcta?" />
        </div>
        <div>
          <label>Tipo</label>
          <select class="question-type-input">
            <option value="multiple_choice" ${q.type === 'multiple_choice' ? 'selected' : ''}>Opción múltiple</option>
            <option value="true_false" ${q.type === 'true_false' ? 'selected' : ''}>Verdadero / Falso</option>
            <option value="open" ${q.type === 'open' ? 'selected' : ''}>Respuesta abierta</option>
          </select>
        </div>
      </div>
      <div class="question-options-wrap" style="display:${q.type !== 'open' ? 'block' : 'none'}">
        <label>Opciones <span class="hint">(marcá la correcta)</span></label>
        <div class="question-options-list">
          ${(q.options || []).map((opt, oi) => questionOptionRowHtml(opt, oi, q.correctOption, q.type, i)).join('')}
        </div>
        ${q.type === 'multiple_choice' ? '<button type="button" class="btn btn-ghost btn-sm add-option-btn">+ Agregar opción</button>' : ''}
      </div>
      <div class="field-row-footer">
        <label class="active-check-label" style="margin:0;">Puntos <input type="number" class="question-points-input" value="${q.points}" min="0.5" step="0.5" style="width:70px; margin-left:6px;" /></label>
        <button type="button" class="btn btn-danger btn-sm remove-question-btn">Eliminar pregunta</button>
      </div>
    </div>
  `).join('');

  examQuestionsListEl.querySelectorAll('.field-row').forEach((rowEl) => {
    const idx = Number(rowEl.dataset.index);
    rowEl.querySelector('.question-prompt-input').addEventListener('input', (e) => { currentExamQuestions[idx].prompt = e.target.value; });
    rowEl.querySelector('.question-type-input').addEventListener('change', (e) => {
      const newType = e.target.value;
      const q = currentExamQuestions[idx];
      q.type = newType;
      if (newType === 'true_false') {
        q.options = ['Verdadero', 'Falso'];
        q.correctOption = 0;
      } else if (newType === 'multiple_choice') {
        q.options = Array.isArray(q.options) && q.options.length >= 2 ? q.options : ['', ''];
        q.correctOption = null;
      } else {
        q.options = null;
        q.correctOption = null;
      }
      renderExamQuestionRows();
    });
    rowEl.querySelectorAll('.question-option-correct').forEach((radio) => {
      radio.addEventListener('change', (e) => { currentExamQuestions[idx].correctOption = Number(e.target.dataset.optionIndex); });
    });
    rowEl.querySelectorAll('.question-option-text').forEach((input, oi) => {
      input.addEventListener('input', (e) => { currentExamQuestions[idx].options[oi] = e.target.value; });
    });
    const addOptionBtn = rowEl.querySelector('.add-option-btn');
    if (addOptionBtn) {
      addOptionBtn.addEventListener('click', () => {
        currentExamQuestions[idx].options.push('');
        renderExamQuestionRows();
      });
    }
    rowEl.querySelectorAll('.remove-option-btn').forEach((btn, oi) => {
      btn.addEventListener('click', () => {
        const q = currentExamQuestions[idx];
        q.options.splice(oi, 1);
        if (q.correctOption !== null && q.correctOption >= q.options.length) q.correctOption = null;
        renderExamQuestionRows();
      });
    });
    rowEl.querySelector('.question-points-input').addEventListener('input', (e) => { currentExamQuestions[idx].points = Number(e.target.value) || 1; });
    rowEl.querySelector('.remove-question-btn').addEventListener('click', () => {
      currentExamQuestions.splice(idx, 1);
      renderExamQuestionRows();
    });
  });
}

document.getElementById('add-question-btn').addEventListener('click', () => {
  currentExamQuestions.push({ type: 'multiple_choice', prompt: '', options: ['', ''], correctOption: null, points: 1 });
  renderExamQuestionRows();
});

document.getElementById('exam-save-btn').addEventListener('click', async () => {
  const msg = document.getElementById('exam-message');
  msg.className = 'message';
  msg.textContent = '';

  const title = document.getElementById('exam-title').value.trim();
  const description = document.getElementById('exam-description').value.trim();
  const passingPercent = Number(document.getElementById('exam-passing-percent').value) || 60;

  if (!title) {
    msg.className = 'message error';
    msg.textContent = 'Ponele un título al examen.';
    return;
  }
  if (currentExamQuestions.length === 0) {
    msg.className = 'message error';
    msg.textContent = 'Agregá al menos una pregunta.';
    return;
  }

  const body = {
    title,
    description,
    passingPercent,
    questions: currentExamQuestions.map((q) => ({
      type: q.type,
      prompt: q.prompt,
      points: q.points,
      options: q.type !== 'open' ? q.options : undefined,
      correctOption: q.type !== 'open' ? q.correctOption : undefined,
    })),
  };
  if (currentEditingExamId) body.active = document.getElementById('exam-active').checked;

  const saveBtn = document.getElementById('exam-save-btn');
  saveBtn.disabled = true;
  try {
    const url = currentEditingExamId ? `/api/academy-exams/${currentEditingExamId}` : `/api/academy-courses/${currentCourseId}/exams`;
    const method = currentEditingExamId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el examen');

    showToast(currentEditingExamId ? 'Examen actualizado.' : 'Examen creado.');
    await loadExams(currentCourseId);
    showExamsListView();
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById('exam-cancel-btn').addEventListener('click', showExamsListView);
document.getElementById('new-exam-btn').addEventListener('click', openNewExamEditor);
document.getElementById('exam-submissions-back-btn').addEventListener('click', showExamsListView);

async function openExamSubmissions(examId) {
  currentViewingExamId = examId;
  examSubmissionsListEl.innerHTML = '<div class="staff-empty">Cargando…</div>';
  showExamSubmissionsView();
  const res = await fetch(`/api/academy-exams/${examId}/submissions`);
  if (!res.ok) return;
  const rows = await res.json();
  renderExamSubmissions(rows);
}

function examSubmissionStatusPill(s) {
  if (s.status !== 'corregido') return '<span class="status-pill status-pendiente">Pendiente de corrección</span>';
  return `<span class="status-pill ${s.passed ? 'status-aprobado' : 'status-rechazado'}">${s.passed ? 'Aprobado' : 'Reprobado'} · ${s.score}/${s.max_score}</span>`;
}

function renderExamSubmissions(rows) {
  if (rows.length === 0) {
    examSubmissionsListEl.innerHTML = '';
    examSubmissionsEmptyEl.style.display = 'block';
    return;
  }
  examSubmissionsEmptyEl.style.display = 'none';
  examSubmissionsListEl.innerHTML = rows.map((s) => `
    <div class="field-row" data-submission-id="${s.id}">
      <div class="field-row-footer" style="margin-top:0;">
        <span class="staff-username">${escapeHtml(s.cadet_name)}</span>
        ${examSubmissionStatusPill(s)}
        <span class="muted-link">${formatDate(s.submitted_at)}</span>
      </div>
      ${s.answers.map((a) => `
        <div class="report-field-value">
          <div class="k">${escapeHtml(a.prompt)}${a.type !== 'open' ? ` (${a.points_awarded === a.question_points ? '✓' : '✕'} ${a.question_points} pts)` : ` (${a.question_points} pts)`}</div>
          <div class="v">${a.type === 'open' ? escapeHtml(a.answer_text || '—') : escapeHtml((a.options || [])[a.selected_option] ?? 'Sin responder')}</div>
          ${a.type === 'open' ? `
            <div class="row" style="margin-top:6px;">
              <div>
                <label>Puntos otorgados <span class="hint">(máx ${a.question_points})</span></label>
                <input type="number" class="grade-points-input" data-answer-id="${a.id}" min="0" max="${a.question_points}" step="0.5" value="${a.points_awarded ?? ''}" />
              </div>
            </div>
          ` : ''}
        </div>
      `).join('')}
      ${s.status === 'pendiente' ? `<div class="submit-row" style="margin-top:10px;"><button class="btn btn-primary btn-sm" data-save-grades="${s.id}">Guardar corrección</button></div>` : ''}
      <div class="submit-row" style="margin-top:6px;">
        <button class="btn btn-danger btn-sm" data-delete-submission="${s.id}">Eliminar entrega</button>
      </div>
    </div>
  `).join('');

  examSubmissionsListEl.querySelectorAll('[data-save-grades]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.field-row');
      const grades = Array.from(row.querySelectorAll('.grade-points-input')).map((input) => ({
        answerId: Number(input.dataset.answerId),
        pointsAwarded: Number(input.value) || 0,
      }));
      const res = await fetch(`/api/academy-exam-submissions/${btn.dataset.saveGrades}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grades }),
      });
      if (res.ok) {
        await openExamSubmissions(currentViewingExamId);
        await loadExams(currentCourseId);
        showToast('Corrección guardada.');
      } else {
        const data = await res.json();
        showToast(data.error || 'No se pudo guardar la corrección.', 'danger');
      }
    });
  });

  examSubmissionsListEl.querySelectorAll('[data-delete-submission]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta entrega? El estudiante va a poder rendir el examen de nuevo.')) return;
      await fetch(`/api/academy-exam-submissions/${btn.dataset.deleteSubmission}`, { method: 'DELETE' });
      await openExamSubmissions(currentViewingExamId);
      await loadExams(currentCourseId);
      showToast('Entrega eliminada.', 'danger');
    });
  });
}

checkSession().then(() => {
  // switchTab() ya cargó los datos de la pestaña inicial; acá solo hace
  // falta precargar los rangos si es staff, porque el modal de aprobar
  // postulación los necesita aunque todavía no se haya abierto Personal.
  if (canManage() && ranks.length === 0) loadRanks();
});
