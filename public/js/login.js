const form = document.getElementById('login-form');
const messageEl = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  messageEl.className = 'message';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión');

    window.location.href = '/admin.html';
  } catch (err) {
    messageEl.className = 'message error';
    messageEl.textContent = err.message;
  }
});
