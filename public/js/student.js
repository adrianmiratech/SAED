const DEPARTMENT_LABELS = { sams: 'SAMS', safd: 'SAFD' };
const STUDENT_STATUS_LABELS = { activo: 'Activo', graduado: 'Graduado', expulsado: 'Expulsado', baja: 'Baja' };
const STUDENT_STATUS_PILL_CLASS = { activo: 'status-en_revision', graduado: 'status-aprobado', expulsado: 'status-rechazado', baja: 'status-baja' };

function departmentLabel(department) {
  return DEPARTMENT_LABELS[department] || department;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initials(name) {
  return (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

async function checkStudentSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.authenticated || data.role !== 'cadet') {
    window.location.href = '/login.html';
    return;
  }
  document.getElementById('whoami').textContent = data.fullName || data.username;
  document.getElementById('whoami-avatar').textContent = initials(data.fullName || data.username);
  document.getElementById('whoami-scope').textContent = departmentLabel(data.department);
}

async function loadStudentProfile() {
  const res = await fetch('/api/student/me');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const s = await res.json();
  document.getElementById('student-department').innerHTML = `<span class="dept-badge dept-${s.department}">${departmentLabel(s.department)}</span>`;
  document.getElementById('student-status').innerHTML = `<span class="status-pill ${STUDENT_STATUS_PILL_CLASS[s.status] || 'status-pendiente'}">${STUDENT_STATUS_LABELS[s.status] || s.status}</span>`;
  document.getElementById('student-since').textContent = `Estudiante desde el ${formatDate(s.createdAt)}${s.graduatedAt ? ` · Graduado el ${formatDate(s.graduatedAt)}` : ''}`;
}

function materialRowHtml(m) {
  return `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">📄 ${escapeHtml(m.file_name)}</span>
        <span class="muted-link">${formatBytes(m.file_size)}</span>
      </div>
      <a class="btn btn-primary btn-sm" href="/api/academy-materials/${m.id}/download" target="_blank" rel="noopener">Ver</a>
      <a class="btn btn-ghost btn-sm" href="/api/academy-materials/${m.id}/download?download=1">Descargar</a>
    </div>
  `;
}

async function loadStudentCourses() {
  const listEl = document.getElementById('student-courses-list');
  const emptyEl = document.getElementById('student-courses-empty');
  const res = await fetch('/api/student/courses');
  if (!res.ok) return;
  const courses = await res.json();
  if (courses.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  const materialsByCourse = await Promise.all(courses.map(async (c) => {
    const r = await fetch(`/api/academy-courses/${c.id}/materials`);
    return r.ok ? await r.json() : [];
  }));

  listEl.innerHTML = courses.map((c, i) => `
    <div class="field-row">
      <div class="field-row-footer" style="margin-top:0;">
        <span class="staff-username">${escapeHtml(c.name)}</span>
        ${c.department ? `<span class="dept-badge dept-${c.department}">${departmentLabel(c.department)}</span>` : '<span class="dept-badge">Compartido</span>'}
      </div>
      ${c.description ? `<p class="subtitle" style="margin:4px 0 10px;">${escapeHtml(c.description)}</p>` : ''}
      ${materialsByCourse[i].length > 0
        ? materialsByCourse[i].map(materialRowHtml).join('')
        : '<div class="staff-empty">Todavía no hay materiales cargados para este curso.</div>'}
    </div>
  `).join('');
}

async function loadStudentEvaluations() {
  const listEl = document.getElementById('student-evaluations-list');
  const emptyEl = document.getElementById('student-evaluations-empty');
  const res = await fetch('/api/student/evaluations');
  if (!res.ok) return;
  const rows = await res.json();
  if (rows.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = rows.map((ev) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(ev.title)}</span>
        ${ev.course_name ? `<span class="muted-link">${escapeHtml(ev.course_name)}</span>` : ''}
        ${ev.score !== null && ev.score !== undefined ? `<span class="status-pill status-pendiente">${ev.score}/${ev.max_score}</span>` : ''}
        ${ev.passed === 1 ? '<span class="status-pill status-aprobado">Aprobado</span>' : ev.passed === 0 ? '<span class="status-pill status-rechazado">Reprobado</span>' : ''}
        <span class="muted-link">${formatDate(ev.created_at)}</span>
      </div>
    </div>
  `).join('');
}

// ---- Exámenes ----

function examStatusPill(exam) {
  const s = exam.submission;
  if (!s) return null;
  if (s.status !== 'corregido') return '<span class="status-pill status-pendiente">Pendiente de corrección</span>';
  return `<span class="status-pill ${s.passed ? 'status-aprobado' : 'status-rechazado'}">${s.passed ? 'Aprobado' : 'Reprobado'} · ${s.score}/${s.max_score}</span>`;
}

async function loadStudentExams() {
  const listEl = document.getElementById('student-exams-list');
  const emptyEl = document.getElementById('student-exams-empty');
  const res = await fetch('/api/student/exams');
  if (!res.ok) return;
  const exams = await res.json();
  if (exams.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = exams.map((e) => `
    <div class="staff-row">
      <div class="staff-meta">
        <span class="staff-username">${escapeHtml(e.title)}</span>
        <span class="muted-link">${escapeHtml(e.course_name)} · ${e.question_count} pregunta${e.question_count === 1 ? '' : 's'}</span>
        ${examStatusPill(e) || ''}
      </div>
      ${!e.submission ? `<button class="btn btn-primary btn-sm" data-take-exam="${e.id}">Rendir examen</button>` : ''}
    </div>
  `).join('');

  listEl.querySelectorAll('[data-take-exam]').forEach((btn) => {
    btn.addEventListener('click', () => openTakeExam(Number(btn.dataset.takeExam)));
  });
}

function examQuestionInputHtml(q) {
  if (q.type === 'open') {
    return `
      <div class="field-row">
        <label>${escapeHtml(q.prompt)}</label>
        <textarea class="exam-answer-input" data-question-id="${q.id}" data-type="open"></textarea>
      </div>
    `;
  }
  return `
    <div class="field-row">
      <label>${escapeHtml(q.prompt)}</label>
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
        ${(q.options || []).map((opt, oi) => `
          <label style="display:flex; align-items:center; gap:8px; font-weight:400; margin:0;">
            <input type="radio" name="exam-q-${q.id}" class="exam-answer-input" data-question-id="${q.id}" data-type="${q.type}" value="${oi}" style="width:auto;" />
            ${escapeHtml(opt)}
          </label>
        `).join('')}
      </div>
    </div>
  `;
}

let currentExamId = null;

async function openTakeExam(examId) {
  currentExamId = examId;
  const res = await fetch(`/api/student/exams/${examId}`);
  if (!res.ok) return;
  const exam = await res.json();

  document.getElementById('student-exam-title').textContent = exam.title;
  document.getElementById('student-exam-description').textContent = `${exam.courseName}${exam.description ? ` · ${exam.description}` : ''}`;
  document.getElementById('student-exam-message').className = 'message';
  document.getElementById('student-exam-message').textContent = '';

  const questionsEl = document.getElementById('student-exam-questions');
  const submitBtn = document.getElementById('student-exam-submit-btn');
  if (exam.submission) {
    questionsEl.innerHTML = '<div class="staff-empty">Ya entregaste este examen.</div>';
    submitBtn.style.display = 'none';
  } else {
    questionsEl.innerHTML = exam.questions.map(examQuestionInputHtml).join('');
    submitBtn.style.display = 'inline-flex';
  }

  document.getElementById('student-exams-list-view').style.display = 'none';
  document.getElementById('student-exam-take-view').style.display = 'block';
}

document.getElementById('student-exam-back-btn').addEventListener('click', () => {
  document.getElementById('student-exams-list-view').style.display = 'block';
  document.getElementById('student-exam-take-view').style.display = 'none';
});

document.getElementById('student-exam-submit-btn').addEventListener('click', async () => {
  if (!currentExamId) return;
  if (!confirm('¿Entregar el examen? No vas a poder cambiar tus respuestas después.')) return;

  const msg = document.getElementById('student-exam-message');
  msg.className = 'message';
  msg.textContent = '';

  const answersByQuestion = new Map();
  document.querySelectorAll('#student-exam-questions .exam-answer-input').forEach((el) => {
    const qId = Number(el.dataset.questionId);
    if (el.dataset.type === 'open') {
      answersByQuestion.set(qId, { questionId: qId, answerText: el.value });
    } else if (el.checked) {
      answersByQuestion.set(qId, { questionId: qId, selectedOption: Number(el.value) });
    }
  });

  const submitBtn = document.getElementById('student-exam-submit-btn');
  submitBtn.disabled = true;
  try {
    const res = await fetch(`/api/student/exams/${currentExamId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: Array.from(answersByQuestion.values()) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo entregar el examen');

    document.getElementById('student-exams-list-view').style.display = 'block';
    document.getElementById('student-exam-take-view').style.display = 'none';
    await Promise.all([loadStudentExams(), loadStudentEvaluations()]);
  } catch (err) {
    msg.className = 'message error';
    msg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

(async () => {
  await checkStudentSession();
  await Promise.all([loadStudentProfile(), loadStudentCourses(), loadStudentEvaluations(), loadStudentExams()]);
})();
