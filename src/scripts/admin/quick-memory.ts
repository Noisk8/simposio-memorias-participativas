// @ts-nocheck
import { getAdminToken, waitForAdminAuth } from './client.ts';
const form = document.getElementById('memoria-form');
const notAllowed = document.getElementById('not-allowed');
const loading = document.getElementById('loading');
const status = document.getElementById('status');

waitForAdminAuth().then(function (auth) {
  function refresh() {
    auth.getUser().then(function (user) {
      loading.classList.add('hidden');
      if (!user) {
        form.classList.add('hidden');
        notAllowed.classList.add('hidden');
        return;
      }

      // El acceso real lo valida la Netlify Function; aquí solo mostramos el formulario.
      form.classList.remove('hidden');
      notAllowed.classList.add('hidden');
    });
  }

  auth.ready.then(refresh);
  window.addEventListener('supabase-auth', refresh);
});

form?.addEventListener('submit', async function (e) {
  e.preventDefault();
  status.textContent = 'Enviando...';
  status.className = 'text-sm font-medium text-ugr-text-light';

  var token = await getAdminToken().catch(() => null);
  if (!token) {
    status.textContent = 'No se encontró el token de sesión.';
    status.className = 'text-sm font-medium text-red-600';
    return;
  }

  var data = {
    number: parseInt(document.getElementById('number').value, 10),
    title: document.getElementById('title').value,
    place: document.getElementById('place').value,
    author: document.getElementById('author').value,
    collective: document.getElementById('collective').value,
    image: document.getElementById('image').value,
    description: document.getElementById('description').value,
    body: document.getElementById('body').value,
  };

  try {
    var response = await fetch('/.netlify/functions/manage-content?collection=memorias', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({
        data: {
          draft: true,
          simposio: '2026',
          number: data.number,
          title: data.title,
          place: data.place,
          author: data.author,
          collective: data.collective,
          categories: [],
          tags: [],
          image: data.image,
          description: data.description,
        },
        body: data.body,
      }),
    });

    var result = await response.json();

    if (response.ok) {
      status.textContent = 'Memoria creada. Redesplegando...';
      status.className = 'text-sm font-medium text-green-600';
      form.reset();
    } else {
      status.textContent = (result.error && result.error.message) || 'Error al crear la memoria.';
      status.className = 'text-sm font-medium text-red-600';
    }
  } catch (err) {
    status.textContent = 'Error de red: ' + err.message;
    status.className = 'text-sm font-medium text-red-600';
  }
});
