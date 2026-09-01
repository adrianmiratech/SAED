const form = document.getElementById('app-form');
const messageEl = document.getElementById('message');
const departmentEl = document.getElementById('department');
const previousSaedDetailsWrap = document.getElementById('previousSaedDetailsWrap');

document.querySelectorAll('.dept-apply').forEach((btn) => {
  btn.addEventListener('click', () => {
    departmentEl.value = btn.dataset.department;
  });
});

form.querySelectorAll('input[name="previousSaedExperience"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    previousSaedDetailsWrap.style.display = radio.value === 'Sí' && radio.checked ? 'block' : 'none';
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  messageEl.className = 'message';
  messageEl.textContent = '';

  const criminalRecordEl = form.querySelector('input[name="criminalRecord"]:checked');
  const previousSaedEl = form.querySelector('input[name="previousSaedExperience"]:checked');

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
    previousSaedExperience: previousSaedEl ? previousSaedEl.value : '',
    previousSaedDetails: document.getElementById('previousSaedDetails').value.trim(),
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
    previousSaedDetailsWrap.style.display = 'none';
  } catch (err) {
    messageEl.className = 'message error';
    messageEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
