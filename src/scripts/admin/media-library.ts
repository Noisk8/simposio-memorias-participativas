// @ts-nocheck
import { adminApi, waitForAdminAuth } from './client.ts';
const panel = document.getElementById('media-panel');
const statusNode = document.getElementById('status');
const imagesNode = document.getElementById('images');
const uploadForm = document.getElementById('upload');
const fileInput = document.getElementById('file');
const fileName = document.getElementById('file-name');
const uploadButton = document.getElementById('upload-button');
const mediaSearch = document.getElementById('media-search');
const refreshMedia = document.getElementById('refresh-media');
const mediaEmpty = document.getElementById('media-empty');
const mediaSummary = document.getElementById('media-summary');
const imageMetadata = document.getElementById('image-metadata');
const decorativeInput = document.getElementById('decorative');
const altTextInput = document.getElementById('alt-text');
const creditInput = document.getElementById('credit');
const licenseInput = document.getElementById('license');
let maxMediaBytes = 2 * 1024 * 1024;
let allImages = [];

const api = adminApi;

function setStatus(message, kind = 'loading') {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size = size / 1024;
    unitIndex++;
  }
  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return size.toFixed(precision) + ' ' + units[unitIndex];
}

function getExtension(name) {
  return (
    String(name || '')
      .split('.')
      .pop()
      ?.toUpperCase() || 'IMG'
  );
}

function updateStats(images) {
  const totalSize = images.reduce((sum, image) => sum + Number(image.size || 0), 0);
  const formats = new Set(images.map((image) => getExtension(image.name)));
  document.getElementById('media-count').textContent = images.length;
  document.getElementById('media-size').textContent = formatBytes(totalSize);
  document.getElementById('media-formats').textContent = formats.size;
}

function renderImages() {
  const query = mediaSearch.value.trim().toLocaleLowerCase('es');
  const visibleImages = allImages.filter((image) =>
    [image.name, image.path, getExtension(image.name)]
      .join(' ')
      .toLocaleLowerCase('es')
      .includes(query)
  );

  imagesNode.innerHTML = '';
  imagesNode.classList.toggle('hidden', visibleImages.length === 0);
  mediaEmpty.classList.toggle('hidden', visibleImages.length !== 0);
  mediaSummary.textContent =
    visibleImages.length === allImages.length
      ? allImages.length +
        (allImages.length === 1 ? ' imagen disponible.' : ' imágenes disponibles.')
      : visibleImages.length + ' de ' + allImages.length + ' imágenes.';

  visibleImages.forEach((image) => imagesNode.appendChild(createImageCard(image)));
}

function createImageCard(image) {
  const card = document.createElement('article');
  card.className = 'cms-media-card';

  const preview = document.createElement('div');
  preview.className = 'cms-media-preview';
  if (image.kind === 'image') {
    const img = document.createElement('img');
    img.src = image.previewUrl || image.publicUrl || image.path;
    img.alt = image.altText || '';
    img.loading = 'lazy';
    preview.appendChild(img);
  } else {
    const type = document.createElement('strong');
    type.textContent = 'PDF';
    preview.appendChild(type);
  }

  const body = document.createElement('div');
  body.className = 'cms-media-card-body';

  const meta = document.createElement('div');
  meta.className = 'cms-media-card-meta';
  const name = document.createElement('strong');
  name.textContent = image.name;
  const details = document.createElement('span');
  details.textContent = getExtension(image.name) + ' · ' + formatBytes(image.size);
  meta.append(name, details);

  const actions = document.createElement('div');
  actions.className = 'cms-media-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'cms-media-copy';
  copyButton.textContent = 'Copiar URL';
  copyButton.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(image.path);
      setStatus('URL copiada: ' + image.path, 'success');
    } catch (error) {
      setStatus('No se pudo copiar la ruta: ' + error.message, 'error');
    }
  });

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'cms-media-delete';
  deleteButton.textContent = 'Eliminar';
  deleteButton.addEventListener('click', async function () {
    if (!confirm('¿Eliminar ' + image.name + '?')) return;
    deleteButton.disabled = true;
    setStatus('Eliminando ' + image.name + '…', 'loading');
    try {
      await api('/.netlify/functions/manage-media?id=' + encodeURIComponent(image.id), {
        method: 'DELETE',
      });
      await loadImages();
    } catch (error) {
      deleteButton.disabled = false;
      setStatus(error.message, 'error');
    }
  });

  actions.append(copyButton, deleteButton);
  body.append(meta, actions);
  card.append(preview, body);
  return card;
}

async function loadImages() {
  refreshMedia.disabled = true;
  setStatus('Cargando biblioteca de medios…', 'loading');
  try {
    const data = await api('/.netlify/functions/manage-media');
    allImages = data.media || [];
    if (data.policy?.maxBytes) {
      maxMediaBytes = Number(data.policy.maxBytes);
      document.getElementById('media-max-size').textContent = formatBytes(maxMediaBytes);
    }
    updateStats(allImages);
    renderImages();
    setStatus(
      allImages.length + (allImages.length === 1 ? ' medio cargado.' : ' medios cargados.'),
      'success'
    );
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    refreshMedia.disabled = false;
  }
}

uploadForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > maxMediaBytes) {
    setStatus('El archivo debe pesar máximo ' + formatBytes(maxMediaBytes) + '.', 'error');
    return;
  }
  const isImage = file.type.startsWith('image/');
  if (isImage && !decorativeInput.checked && !altTextInput.value.trim()) {
    setStatus('Escribe el texto alternativo o marca la imagen como decorativa.', 'error');
    return;
  }
  if (isImage && (!creditInput.value.trim() || !licenseInput.value.trim())) {
    setStatus('El crédito y la licencia son obligatorios para imágenes.', 'error');
    return;
  }

  uploadButton.disabled = true;
  setStatus('Subiendo ' + file.name + '…', 'loading');
  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const content = String(reader.result).split(',')[1];
      await api('/.netlify/functions/upload-media', {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type,
          content,
          ...(isImage
            ? {
                altText: altTextInput.value.trim(),
                credit: creditInput.value.trim(),
                license: licenseInput.value.trim(),
                decorative: decorativeInput.checked,
              }
            : {}),
        }),
      });
      uploadForm.reset();
      fileName.textContent = 'Seleccionar archivo';
      await loadImages();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      uploadButton.disabled = false;
    }
  };
  reader.onerror = function () {
    uploadButton.disabled = false;
    setStatus('No se pudo leer el archivo seleccionado.', 'error');
  };
  reader.readAsDataURL(file);
});

fileInput.addEventListener('change', function () {
  const file = fileInput.files[0];
  fileName.textContent = file ? file.name + ' · ' + formatBytes(file.size) : 'Seleccionar archivo';
  const isImage = Boolean(file?.type.startsWith('image/'));
  imageMetadata.classList.toggle('hidden', !isImage);
  altTextInput.required = isImage && !decorativeInput.checked;
  creditInput.required = isImage;
  licenseInput.required = isImage;
});

decorativeInput.addEventListener('change', function () {
  altTextInput.disabled = decorativeInput.checked;
  altTextInput.required = !decorativeInput.checked;
  if (decorativeInput.checked) altTextInput.value = '';
});

refreshMedia.addEventListener('click', loadImages);
mediaSearch.addEventListener('input', renderImages);

function start() {
  window.supabaseAuth.ready.then(async () => {
    if (await window.supabaseAuth.getUser()) {
      panel.classList.remove('hidden');
      loadImages();
    }
  });
}

waitForAdminAuth()
  .then(start)
  .catch((error) => setStatus(error.message, 'error'));
