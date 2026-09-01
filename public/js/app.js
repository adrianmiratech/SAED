const form = document.getElementById('app-form');
const messageEl = document.getElementById('message');
const departmentEl = document.getElementById('department');

document.querySelectorAll('.dept-apply').forEach((btn) => {
  btn.addEventListener('click', () => {
    departmentEl.value = btn.dataset.department;
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  messageEl.className = 'message';
  messageEl.textContent = '';

  const criminalRecordEl = form.querySelector('input[name="criminalRecord"]:checked');

  const payload = {
    department: departmentEl.value,
    fullName: document.getElementById('fullName').value.trim(),
    age: document.getElementById('age').value,
    country: document.getElementById('country').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    email: document.getElementById('email').value.trim(),
    discordInfo: document.getElementById('discordInfo').value.trim(),
    experience: document.getElementById('experience').value.trim(),
    motivation: document.getElementById('motivation').value.trim(),
    criminalRecord: criminalRecordEl ? criminalRecordEl.value : '',
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'No se pudo enviar la postulación');
    }

    messageEl.className = 'message success';
    messageEl.textContent = '¡Postulación enviada con éxito! El equipo del SAED la revisará pronto.';
    form.reset();
  } catch (err) {
    messageEl.className = 'message error';
    messageEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
