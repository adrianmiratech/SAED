const form = document.getElementById('fichar-login-form');
const messageEl = document.getElementById('message');
const submitBtn = document.getElementById('fichar-login-submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  messageEl.className = 'message';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Ingresando...';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/employee/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión');

    window.location.href = '/fichaje.html';
  } catch (err) {
    messageEl.className = 'message error';
    messageEl.textContent = err.message;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ingresar';
  }
});
