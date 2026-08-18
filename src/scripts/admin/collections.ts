// @ts-nocheck
import { getAdminToken, waitForAdminAuth } from './client.ts';
const notAllowed = document.getElementById('not-allowed');
const loading = document.getElementById('loading');
const adminPanel = document.getElementById('admin-panel');
const form = document.getElementById('coleccion-form');
const status = document.getElementById('status');

waitForAdminAuth().then(function (auth) {
  function refresh() {
    auth.getUser().then(function (user) {
      loading.classList.add('hidden');
      if (!user) {
        adminPanel.classList.add('hidden');
        notAllowed.classList.add('hidden');
        return;
      }

      // El acceso real lo valida la Netlify Function; aquí solo mostramos el panel.
      adminPanel.classList.remove('hidden');
      notAllowed.classList.add('hidden');
    });
  }

  auth.ready.then(refresh);
  window.addEventListener('supabase-auth', refresh);
});

form?.addEventListener('submit', async function (e) {
  e.preventDefault();
  status.textContent = 'Creando...';
  status.className = 'text-sm font-medium text-ugr-text-light';

  var token = await getAdminToken().catch(() => null);
  if (!token) {
    status.textContent = 'No se encontró el token de sesión.';
    status.className = 'text-sm font-medium text-red-600';
    return;
  }

  var folderName = document
    .getElementById('folder')
    .value.trim()
    .replace(/^src\/content\/?/, '');
  var data = {
    name: document.getElementById('name').value.trim(),
    label: document.getElementById('label').value.trim(),
    folder: 'src/content/' + folderName,
    slug: '{{slug}}',
  };

  try {
    var response = await fetch('/.netlify/functions/manage-collections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(data),
    });

    var result = await response.json();

    if (response.ok) {
      status.textContent = 'Colección creada. Redesplegando...';
      status.className = 'text-sm font-medium text-green-600';
      form.reset();
    } else {
      status.textContent = (result.error && result.error.message) || 'Error al crear la colección.';
      status.className = 'text-sm font-medium text-red-600';
    }
  } catch (err) {
    status.textContent = 'Error de red: ' + err.message;
    status.className = 'text-sm font-medium text-red-600';
  }
});
