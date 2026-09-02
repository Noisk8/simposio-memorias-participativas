// @ts-nocheck
import { getAdminToken, waitForAdminAuth } from './client.ts';
import { defaults, descriptions, groupFields, labels, schemas } from './editor-config.ts';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  hasPendingPublishedChanges,
  hasPublishedVersion,
  isArchivedContent,
  isMainContentListingContent,
  isPublishedListingContent,
  isUnpublishedDraft,
  saveActionLabel,
} from '../../../shared/content/editor-action';
import {
  parseCmsEditorBlock,
  renderCmsEditorBlockHtml,
} from '../../../shared/content/editor-blocks';
import { taxonomyReferenceSlug } from '../../../shared/content/taxonomy-references';

const collection = document.getElementById('collection');
const itemsNode = document.getElementById('items');
const fieldsNode = document.getElementById('fields');
const editor = document.getElementById('editor');
const emptyEditor = document.getElementById('empty-editor');
const statusNode = document.getElementById('status');
const search = document.getElementById('search');
const draftsOnly = document.getElementById('drafts-only');
const sortSelect = document.getElementById('sort');
const collectionNav = document.getElementById('collection-nav');
const previewNode = document.getElementById('live-preview');
const historyNode = document.getElementById('history');
const collectionView = document.getElementById('collection-view');
const collectionTitle = document.getElementById('collection-title');
const collectionDescription = document.getElementById('collection-description');
const mediaLibraryDialog = document.getElementById('media-library-dialog');
const mediaLibrarySearch = document.getElementById('media-library-search');
const mediaLibraryRefresh = document.getElementById('media-library-refresh');
const mediaLibraryStatus = document.getElementById('media-library-status');
const mediaLibraryGrid = document.getElementById('media-library-grid');
const mediaLibrarySelection = document.getElementById('media-library-selection');
const mediaLibrarySelectionCount = document.getElementById('media-library-selection-count');
const mediaLibraryInsertSelection = document.getElementById('media-library-insert-selection');
const entriesBlockDialog = document.getElementById('entries-block-dialog');
const entriesBlockCategory = document.getElementById('entries-block-category');
const entriesBlockLimit = document.getElementById('entries-block-limit');
const entriesBlockLayout = document.getElementById('entries-block-layout');
let items = [];
let globalItems = [];
let current = null;
let gridView = true;
let permissions = [];
let dirty = false;
let changeGeneration = 0;
let saveInFlight = false;
let localDraftTimer;
let autosaveTimer;
let mediaLibrary = [];
let mediaPickerTarget = null;
let mediaPickerLastFocus = null;
let mediaPickerMode = 'single';
let mediaPickerSelection = new Map();
const references = { categorias: [], etiquetas: [], simposios: [], paginas: [] };
function esc(value) {
  const node = document.createElement('span');
  node.textContent = String(value || '');
  return node.innerHTML;
}
function getPublicUrl(collectionName, path, data = {}) {
  const origin = String(window.location.origin).replace(/\/+$/, '');
  const stem = String(path || '')
    .split('/')
    .pop()
    .replace(/\.md$/i, '');
  if (!stem) return '';
  if (collectionName === 'entradas') return origin + '/entradas/' + stem;
  if (collectionName === 'memorias') {
    const number = String(data.number || stem.split('-')[0] || '').trim();
    return number ? origin + '/museo-memorias/' + number : '';
  }
  if (collectionName === 'paginas') {
    const slug = String(data.slug || stem.replace(/^\d{4}-/, '') || '').trim();
    return slug ? origin + '/' + slug.replace(/^\/+/, '') : '';
  }
  if (collectionName === 'simposios') {
    const slug = String(data.slug || stem || '').trim();
    return slug ? origin + '/ediciones/' + slug : '';
  }
  return '';
}
function resolvePreviewUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(?:https?:\/\/|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith('/images/') && window.cmsMediaPreviewBase) {
    return window.cmsMediaPreviewBase + raw.replace(/^\/images\//, '');
  }
  return raw;
}
async function token() {
  return getAdminToken().catch(() => null);
}
async function api(url, options) {
  const accessToken = await token();
  const response = await fetch(url, {
    ...(options || {}),
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      ...((options || {}).headers || {}),
    },
  });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json'))
    throw new Error(
      'Las funciones administrativas no están disponibles. Usa netlify dev o el sitio publicado.'
    );
  const data = await response.json();
  if (!response.ok) {
    const fields = data.error?.details?.fields;
    const supabase = data.error?.details?.supabase;
    const detailBits = [];
    if (supabase?.code) detailBits.push('Supabase ' + supabase.code);
    if (supabase?.message) detailBits.push(supabase.message);
    if (supabase?.hint) detailBits.push(supabase.hint);
    throw new Error(
      data.error?.message +
        (fields ? ' ' + fields.map((f) => f.path + ': ' + f.message).join('; ') : '') +
        (detailBits.length ? ' (' + detailBits.join(' · ') + ')' : '')
    );
  }
  return data;
}
function formatMediaBytes(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
}
function mediaValue(media) {
  return String(media?.publicUrl || media?.path || '').trim();
}
function mediaAsEditorImage(media) {
  return {
    src: mediaValue(media),
    alt: media?.decorative ? '' : String(media?.altText || ''),
    credit: String(media?.credit || ''),
    license: String(media?.license || ''),
  };
}
function insertCmsBlock(block) {
  window.dispatchEvent(new CustomEvent('cms:block-insert', { detail: { block } }));
}
function renderSelectedMedia(input, selectedNode, media = null) {
  selectedNode.innerHTML = '';
  const value = String(input.value || '').trim();
  selectedNode.classList.toggle('hidden', !value);
  if (!value) return;

  const image = document.createElement('img');
  image.src = media?.previewUrl || media?.publicUrl || resolvePreviewUrl(value);
  image.alt = media?.decorative ? '' : media?.altText || '';
  image.loading = 'lazy';

  const copy = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = media?.name || 'Imagen seleccionada';
  const detail = document.createElement('span');
  detail.textContent = media
    ? [
        media.width && media.height ? media.width + ' × ' + media.height + ' px' : '',
        formatMediaBytes(media.size),
        media.credit || '',
      ]
        .filter(Boolean)
        .join(' · ')
    : value;
  copy.append(name, detail);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Quitar';
  remove.addEventListener('click', () => {
    input.value = '';
    delete input.dataset.previewSrc;
    renderSelectedMedia(input, selectedNode);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  selectedNode.append(image, copy, remove);
}
function chooseLibraryMedia(media) {
  if (!mediaPickerTarget) return;
  if (mediaPickerMode === 'multiple') {
    const key = media.id || mediaValue(media);
    if (mediaPickerSelection.has(key)) mediaPickerSelection.delete(key);
    else mediaPickerSelection.set(key, media);
    renderMediaLibrary();
    updateMediaPickerSelection();
    return;
  }
  if (typeof mediaPickerTarget.onChoose === 'function') {
    mediaPickerTarget.onChoose(media);
    closeMediaPicker();
    return;
  }
  const value = mediaValue(media);
  if (!value) return;
  mediaPickerTarget.input.value = value;
  mediaPickerTarget.input.dataset.previewSrc = media.previewUrl || value;
  renderSelectedMedia(mediaPickerTarget.input, mediaPickerTarget.selectedNode, media);
  mediaPickerTarget.uploadPanel.classList.add('hidden');
  mediaPickerTarget.input.dispatchEvent(new Event('input', { bubbles: true }));
  closeMediaPicker();
}
function renderMediaLibrary() {
  const query = mediaLibrarySearch.value.trim().toLocaleLowerCase('es');
  const images = mediaLibrary.filter(
    (media) =>
      (media.kind === 'image' || String(media.mimeType || '').startsWith('image/')) &&
      [media.name, media.altText, media.credit, media.license]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('es')
        .includes(query)
  );
  mediaLibraryGrid.innerHTML = '';
  mediaLibraryStatus.dataset.kind = images.length ? 'success' : 'empty';
  mediaLibraryStatus.textContent = images.length
    ? images.length + (images.length === 1 ? ' imagen disponible.' : ' imágenes disponibles.')
    : query
      ? 'No hay imágenes que coincidan con la búsqueda.'
      : 'La biblioteca todavía no contiene imágenes.';

  images.forEach((media) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cms-media-picker-card';
    card.setAttribute('aria-label', 'Usar ' + (media.name || 'esta imagen'));
    if (
      (mediaPickerMode === 'multiple' && mediaPickerSelection.has(media.id || mediaValue(media))) ||
      (mediaPickerMode === 'single' &&
        mediaPickerTarget?.input &&
        mediaValue(media) === mediaPickerTarget.input.value)
    ) {
      card.dataset.selected = 'true';
    }
    const image = document.createElement('img');
    image.src = media.previewUrl || media.publicUrl || media.path;
    image.alt = media.decorative ? '' : media.altText || '';
    image.loading = 'lazy';
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = media.name || 'Imagen sin nombre';
    const detail = document.createElement('small');
    detail.textContent = [
      media.width && media.height ? media.width + ' × ' + media.height : '',
      formatMediaBytes(media.size),
    ]
      .filter(Boolean)
      .join(' · ');
    text.append(name, detail);
    const action = document.createElement('b');
    action.textContent = card.dataset.selected
      ? 'Seleccionada'
      : mediaPickerMode === 'multiple'
        ? 'Seleccionar'
        : 'Usar imagen';
    card.append(image, text, action);
    card.addEventListener('click', () => chooseLibraryMedia(media));
    mediaLibraryGrid.appendChild(card);
  });
}
function updateMediaPickerSelection() {
  const count = mediaPickerSelection.size;
  mediaLibrarySelectionCount.textContent =
    count + (count === 1 ? ' imagen seleccionada' : ' imágenes seleccionadas');
  mediaLibraryInsertSelection.disabled = count === 0;
}
async function loadMediaLibrary(force = false) {
  if (mediaLibrary.length && !force) {
    renderMediaLibrary();
    return;
  }
  mediaLibraryRefresh.disabled = true;
  mediaLibraryStatus.dataset.kind = 'loading';
  mediaLibraryStatus.textContent = 'Cargando biblioteca…';
  mediaLibraryGrid.innerHTML = '';
  try {
    const result = await api('/.netlify/functions/manage-media');
    mediaLibrary = result.media || [];
    renderMediaLibrary();
  } catch (error) {
    mediaLibraryStatus.dataset.kind = 'error';
    mediaLibraryStatus.textContent = error.message;
  } finally {
    mediaLibraryRefresh.disabled = false;
  }
}
function openMediaPicker(target, trigger) {
  mediaPickerTarget = target;
  mediaPickerLastFocus = trigger || document.activeElement;
  mediaPickerMode = target?.mode === 'multiple' ? 'multiple' : 'single';
  mediaPickerSelection = new Map();
  mediaLibrarySelection.classList.toggle('hidden', mediaPickerMode !== 'multiple');
  updateMediaPickerSelection();
  mediaLibrarySearch.value = '';
  mediaLibraryDialog.classList.remove('hidden');
  document.body.classList.add('cms-modal-open');
  loadMediaLibrary().then(() => mediaLibrarySearch.focus());
}
function closeMediaPicker() {
  mediaLibraryDialog.classList.add('hidden');
  document.body.classList.remove('cms-modal-open');
  mediaPickerTarget = null;
  mediaPickerMode = 'single';
  mediaPickerSelection = new Map();
  mediaLibrarySelection.classList.add('hidden');
  if (mediaPickerLastFocus?.focus) mediaPickerLastFocus.focus();
  mediaPickerLastFocus = null;
}
mediaLibrarySearch.addEventListener('input', renderMediaLibrary);
mediaLibraryRefresh.addEventListener('click', () => loadMediaLibrary(true));
mediaLibraryInsertSelection.addEventListener('click', () => {
  if (!mediaPickerTarget || mediaPickerMode !== 'multiple' || !mediaPickerSelection.size) return;
  mediaPickerTarget.onChooseMany?.(Array.from(mediaPickerSelection.values()));
  closeMediaPicker();
});
document
  .querySelectorAll('[data-close-media-picker]')
  .forEach((button) => button.addEventListener('click', closeMediaPicker));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !mediaLibraryDialog.classList.contains('hidden')) {
    closeMediaPicker();
  } else if (event.key === 'Escape' && !entriesBlockDialog.classList.contains('hidden')) {
    closeEntriesBlockDialog();
  }
});
function openEntriesBlockDialog() {
  entriesBlockCategory.innerHTML = '';
  references.categorias.filter(isPublishedReference).forEach((item) => {
    const option = document.createElement('option');
    option.value = referenceValue('categorias', item);
    option.textContent = item.data.title;
    entriesBlockCategory.appendChild(option);
  });
  entriesBlockLimit.value = '6';
  entriesBlockLayout.value = 'grid';
  entriesBlockDialog.classList.remove('hidden');
  document.body.classList.add('cms-modal-open');
  entriesBlockCategory.focus();
}
function closeEntriesBlockDialog() {
  entriesBlockDialog.classList.add('hidden');
  document.body.classList.remove('cms-modal-open');
}
document
  .querySelectorAll('[data-close-entries-block]')
  .forEach((button) => button.addEventListener('click', closeEntriesBlockDialog));
document.getElementById('entries-block-insert').addEventListener('click', () => {
  const category = entriesBlockCategory.value;
  if (!category) {
    setStatus('Primero debes crear o seleccionar una categoría.', true);
    return;
  }
  insertCmsBlock({
    type: 'entries',
    category,
    limit: Math.min(12, Math.max(1, Number(entriesBlockLimit.value || 6))),
    layout: entriesBlockLayout.value === 'carousel' ? 'carousel' : 'grid',
  });
  closeEntriesBlockDialog();
});
document.querySelectorAll('[data-block-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.blockAction;
    if (action === 'quote') {
      window.dispatchEvent(new CustomEvent('cms:quote-insert'));
      return;
    }
    if (action === 'entries') {
      openEntriesBlockDialog();
      return;
    }
    if (action === 'image') {
      openMediaPicker(
        {
          onChoose(media) {
            insertCmsBlock({ type: 'image', image: mediaAsEditorImage(media) });
          },
        },
        button
      );
      return;
    }
    openMediaPicker(
      {
        mode: 'multiple',
        onChooseMany(media) {
          insertCmsBlock({
            type: 'gallery',
            layout: action === 'carousel' ? 'carousel' : 'grid',
            images: media.map(mediaAsEditorImage),
          });
        },
      },
      button
    );
  });
});
function setStatus(message, error, allowHtml = false) {
  if (allowHtml) statusNode.innerHTML = message;
  else statusNode.textContent = message;
  statusNode.className =
    'cms-api-status mb-5 rounded-lg p-4 text-sm shadow-sm ' +
    (error ? 'bg-red-50 text-red-700' : 'bg-white text-ugr-text-light');
  statusNode.classList.toggle('cms-api-error', Boolean(error));
}
async function checkDeployment() {
  const node = document.getElementById('deploy-status');
  try {
    const result = await api('/.netlify/functions/deploy-status');
    const labels = {
      success: 'publicado',
      pending: 'en curso',
      failure: 'fallido',
      error: 'con errores',
    };
    node.textContent = 'Despliegue: ' + (labels[result.state] || result.state || 'sin estado');
    node.dataset.state = result.state || 'unknown';
  } catch {
    node.textContent = 'Despliegue: no disponible';
    node.dataset.state = 'unknown';
  }
}

function createNavigation() {
  collectionNav.innerHTML = '';
  Object.entries(labels).forEach(([key, label]) => {
    if (key === 'categorias') {
      const divider = document.createElement('div');
      divider.className = 'cms-side-divider';
      collectionNav.appendChild(divider);
      const title = document.createElement('p');
      title.className = 'cms-side-title';
      title.textContent = 'TAXONOMÍAS';
      collectionNav.appendChild(title);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.collection = key;
    button.innerHTML = '<span>▣</span>' + esc(label);
    button.className = collection.value === key ? 'active' : '';
    button.onclick = () => {
      collection.value = key;
      draftsOnly.checked = false;
      createNavigation();
      loadItems();
    };
    collectionNav.appendChild(button);
  });
  const divider = document.createElement('div');
  divider.className = 'cms-side-divider';
  collectionNav.appendChild(divider);
  const title = document.createElement('p');
  title.className = 'cms-side-title';
  title.textContent = 'ADMINISTRACIÓN';
  collectionNav.appendChild(title);
  [
    ['/admin/medios', '▧ Biblioteca de imágenes'],
    ['/admin/gestion-usuarios', '♟ Usuarios y roles'],
    ['/admin/gestion-colecciones', '⚙ Gestionar colecciones'],
  ].forEach(([href, label]) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    collectionNav.appendChild(link);
  });
}

async function loadReferences() {
  const loaded = await Promise.all(
    Object.keys(labels).map(async (name) => {
      try {
        const list =
          (await api('/.netlify/functions/manage-content?collection=' + name)).items || [];
        if (name in references) references[name] = list;
        return list.map((item) => ({ ...item, collection: name }));
      } catch {
        if (name in references) references[name] = [];
        return [];
      }
    })
  );
  globalItems = loaded.flat();
}

async function loadItems() {
  current = null;
  editor.classList.add('hidden');
  historyNode.classList.add('hidden');
  collectionView.classList.remove('hidden');
  collectionTitle.textContent = labels[collection.value];
  collectionDescription.textContent = descriptions[collection.value];
  document.getElementById('header-new-button').textContent =
    '＋ ' +
    (collection.value === 'simposios'
      ? 'Edición de simposio'
      : collection.value === 'memorias'
        ? 'Memoria'
        : collection.value === 'paginas'
          ? 'Página'
          : collection.value === 'categorias'
            ? 'Categoría'
            : collection.value === 'etiquetas'
              ? 'Etiqueta'
              : 'Entrada');
  const group = document.getElementById('group');
  group.innerHTML = '<option value="">Group by</option>';
  groupFields[collection.value].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = 'Agrupar · ' + label;
    group.appendChild(option);
  });
  itemsNode.innerHTML = '<p class="text-sm text-gray-500">Cargando…</p>';
  try {
    const result = await api(
      '/.netlify/functions/manage-content?collection=' + encodeURIComponent(collection.value)
    );
    items = result.items || [];
    permissions = result.permissions || [];
    applyPermissions();
    renderItems();
    setStatus(items.length + ' contenidos cargados.');
  } catch (error) {
    itemsNode.innerHTML = '';
    setStatus(error.message, true);
  }
}
function permissionBase() {
  return collection.value === 'entradas'
    ? 'entrada'
    : collection.value === 'memorias'
      ? 'memoria'
      : collection.value === 'paginas'
        ? 'pagina'
        : collection.value === 'simposios'
          ? 'simposio'
          : 'taxonomy';
}
function can(action) {
  const permission =
    permissionBase() === 'taxonomy' ? 'taxonomy.manage' : permissionBase() + '.' + action;
  return permissions.includes(permission);
}
function applyPermissions() {
  const mayCreate = can('create');
  document.getElementById('new-button').classList.toggle('hidden', !mayCreate);
  document.getElementById('header-new-button').classList.toggle('hidden', !mayCreate);
}
function renderItems() {
  const query = search.value.trim().toLowerCase();
  const source = query
    ? globalItems
    : items.map((item) => ({ ...item, collection: collection.value }));
  const filtered = source.filter((item) => {
    const usesEditorialLists = ['entradas', 'memorias', 'paginas'].includes(item.collection);
    const matchesList = usesEditorialLists
      ? draftsOnly.checked
        ? isUnpublishedDraft(item)
        : isMainContentListingContent(item)
      : draftsOnly.checked
        ? item.data.draft
        : true;
    return (
      matchesList &&
      (!query ||
        String(item.data.title || item.name)
          .toLowerCase()
          .includes(query))
    );
  });
  filtered.sort((a, b) => {
    const groupKey = document.getElementById('group').value;
    const key = groupKey || sortSelect.value;
    return String(a.data[key] ?? '').localeCompare(String(b.data[key] ?? ''), undefined, {
      numeric: true,
    });
  });
  itemsNode.className = gridView ? 'cms-cards grid-view' : 'cms-cards list-view';
  itemsNode.innerHTML = filtered.length
    ? ''
    : '<p class="text-sm text-gray-500">No hay resultados.</p>';
  let previousGroup = null;
  const groupKey = document.getElementById('group').value;
  filtered.forEach((item) => {
    let groupValue = groupKey ? String(item.data[groupKey] || 'Sin asignar') : '';
    if (groupKey === 'date') groupValue = groupValue.slice(0, 7) || 'Sin fecha';
    if (groupKey && groupValue !== previousGroup) {
      const heading = document.createElement('h2');
      heading.className = 'cms-group-title';
      heading.textContent = groupValue;
      itemsNode.appendChild(heading);
      previousGroup = groupValue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cms-entry-card';
    const imageUrl = resolvePreviewUrl(item.data.image);
    const archived = isArchivedContent(item);
    const unavailableReference =
      ['categorias', 'etiquetas'].includes(item.collection) &&
      item.workflow?.reference_available === false;
    const published = !unavailableReference && isPublishedListingContent(item);
    const pendingChanges = hasPendingPublishedChanges(item);
    const publicUrl = published ? getPublicUrl(item.collection, item.path, item.data) : '';
    button.innerHTML =
      '<span class="cms-card-title">' +
      esc(item.data.title || item.name) +
      '</span>' +
      (imageUrl
        ? '<img src="' + esc(imageUrl) + '" alt="" loading="lazy" decoding="async">'
        : '<div class="cms-card-placeholder"></div>') +
      '<span class="cms-card-meta">' +
      (unavailableReference
        ? 'No publicada en GitHub · '
        : archived
          ? 'Archivada · '
          : pendingChanges
            ? 'Cambios sin publicar · '
            : !published
              ? 'Borrador · '
              : '') +
      esc(publicUrl || item.path || item.name) +
      '</span>';
    button.onclick = () => {
      if (item.collection !== collection.value) {
        collection.value = item.collection;
        createNavigation();
      }
      openEditor(item);
    };
    itemsNode.appendChild(button);
  });
}
function fieldElement(def, value) {
  const [key, label, type, required] = def;
  const wrapper = document.createElement('div');
  wrapper.className = type === 'textarea' ? 'md:col-span-2' : '';
  if (type === 'boolean') {
    wrapper.innerHTML =
      '<label class="mt-6 flex items-center gap-2 text-sm font-semibold"><input data-key="' +
      key +
      '" type="checkbox" ' +
      (value ? 'checked' : '') +
      '> ' +
      esc(label) +
      '</label>';
    return wrapper;
  }
  const labelNode = document.createElement('label');
  labelNode.className = 'mb-1 block text-sm font-semibold';
  labelNode.textContent = label;
  wrapper.appendChild(labelNode);
  let input;
  if (type === 'textarea' || type === 'json') {
    input = document.createElement('textarea');
    input.rows = type === 'json' ? 12 : 3;
  } else if (type.startsWith('select:')) {
    input = document.createElement('select');
    type
      .slice(7)
      .split('|')
      .forEach((option) => {
        const o = document.createElement('option');
        o.value = option;
        o.textContent = option;
        input.appendChild(o);
      });
  } else if (type.startsWith('relation:') || type.startsWith('relations:')) {
    input = document.createElement('select');
    const multiple = type.startsWith('relations:');
    const source = type.split(':')[1];
    input.multiple = multiple;
    if (multiple) input.size = Math.min(6, Math.max(3, references[source].length));
    else {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '— Sin seleccionar —';
      input.appendChild(empty);
    }
    const currentSimposio =
      fieldsNode.querySelector('[data-key="simposio"]')?.value ||
      current?.data?.simposio ||
      defaults.simposio;
    const sourceItems =
      key === 'page_id'
        ? references[source].filter(
            (item) =>
              isPublishedReference(item) &&
              String(item.data.simposio || defaults.simposio) === String(currentSimposio)
          )
        : source === 'categorias' || source === 'etiquetas'
          ? references[source].filter(isPublishedReference)
          : references[source];
    sourceItems.forEach((item) => {
      if (current && item.path === current.path) return;
      const option = document.createElement('option');
      option.value = key === 'page_id' ? item.data.id : referenceValue(source, item);
      option.textContent =
        item.data.title +
        (key === 'page_id' && item.data.slug
          ? ' · /' + item.data.slug
          : item.data.year
            ? ' · ' + item.data.year
            : '');
      const selected = multiple
        ? Array.isArray(value) && value.includes(option.value)
        : value === option.value;
      option.selected = selected;
      input.appendChild(option);
    });
    const selectedValues = multiple ? (Array.isArray(value) ? value : []) : value ? [value] : [];
    const availableValues = new Set(Array.from(input.options).map((option) => option.value));
    selectedValues.forEach((selectedValue) => {
      if (!selectedValue || availableValues.has(selectedValue)) return;
      const option = document.createElement('option');
      option.value = selectedValue;
      option.textContent = `${selectedValue} · no publicada; selecciona otra opción`;
      option.disabled = true;
      input.appendChild(option);
    });
  } else {
    input = document.createElement('input');
    input.type = type === 'list' ? 'text' : type;
  }
  input.dataset.key = key;
  input.id = 'field-' + key;
  labelNode.htmlFor = input.id;
  input.required = required === 'required';
  input.className = 'w-full rounded-lg border border-gray-300 px-3 py-2';
  if (!type.startsWith('relation'))
    input.value =
      type === 'list' && Array.isArray(value)
        ? value.join(', ')
        : type === 'json'
          ? JSON.stringify(value || [], null, 2)
          : (value ?? '');
  wrapper.appendChild(input);
  const errorNode = document.createElement('p');
  errorNode.id = input.id + '-error';
  errorNode.className = 'cms-field-error hidden';
  errorNode.setAttribute('role', 'alert');
  wrapper.appendChild(errorNode);
  input.setAttribute('aria-describedby', errorNode.id);
  const validate = () => {
    const empty = input.required && !String(input.value || '').trim();
    input.setCustomValidity(empty ? `${label} es obligatorio.` : '');
    errorNode.textContent = empty ? `Completa ${label.toLowerCase()} para continuar.` : '';
    errorNode.classList.toggle('hidden', !empty);
    input.classList.toggle('border-red-500', empty);
    return !empty;
  };
  input.addEventListener('input', validate);
  input.addEventListener('change', validate);
  if (key === 'page_id') {
    const help = document.createElement('p');
    help.className = 'cms-field-help';
    help.textContent =
      'Opcional. Al publicar, la entrada aparecerá también al final de la página seleccionada. Solo se muestran páginas ya publicadas de esta edición.';
    wrapper.appendChild(help);
  }
  if (['image', 'poster', 'instituciones_image'].includes(key)) {
    wrapper.className = (wrapper.className + ' cms-image-field').trim();
    input.autocomplete = 'off';
    const help = document.createElement('p');
    help.className = 'cms-image-help';
    help.textContent = 'Elige una imagen existente, sube una nueva o conserva una URL compatible.';

    const selectedMedia = document.createElement('div');
    selectedMedia.className = 'cms-selected-media hidden';

    const mediaActions = document.createElement('div');
    mediaActions.className = 'cms-image-actions';
    const libraryButton = document.createElement('button');
    libraryButton.type = 'button';
    libraryButton.className = 'cms-image-library-button';
    libraryButton.textContent = '▧ Elegir de la biblioteca';

    const uploadToggle = document.createElement('button');
    uploadToggle.type = 'button';
    uploadToggle.className = 'cms-image-upload-button';
    uploadToggle.textContent = '↑ Subir nueva';
    mediaActions.append(libraryButton, uploadToggle);

    const uploadPanel = document.createElement('div');
    uploadPanel.className = 'cms-image-upload-panel hidden';
    const uploadTitle = document.createElement('strong');
    uploadTitle.textContent = 'Nueva imagen';
    const uploadHelp = document.createElement('p');
    uploadHelp.textContent = 'JPEG, PNG o WebP. Máximo 2 MiB.';

    const mediaMetadata = document.createElement('div');
    mediaMetadata.className = 'cms-image-metadata';

    const decorativeLabel = document.createElement('label');
    decorativeLabel.className = 'flex items-center gap-2';
    const decorative = document.createElement('input');
    decorative.type = 'checkbox';
    decorativeLabel.append(decorative, document.createTextNode(' Imagen decorativa'));

    function metadataField(placeholder) {
      const field = document.createElement('input');
      field.type = 'text';
      field.placeholder = placeholder;
      field.className = 'w-full rounded-lg border border-gray-300 px-3 py-2';
      return field;
    }
    const mediaAlt = metadataField('Texto alternativo de la imagen');
    const mediaCredit = metadataField('Crédito (obligatorio)');
    const mediaLicense = metadataField('Licencia (obligatoria, ej. CC BY-SA 4.0)');
    decorative.onchange = () => {
      mediaAlt.disabled = decorative.checked;
      if (decorative.checked) mediaAlt.value = '';
    };
    mediaMetadata.append(decorativeLabel, mediaAlt, mediaCredit, mediaLicense);

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp';
    picker.className = 'cms-image-file';
    const uploadStatus = document.createElement('p');
    uploadStatus.className = 'cms-image-upload-status';
    uploadStatus.setAttribute('aria-live', 'polite');
    const pickerLabel = document.createElement('label');
    pickerLabel.className = 'cms-image-file-label';
    pickerLabel.append(document.createTextNode('Seleccionar archivo'), picker);

    libraryButton.onclick = () =>
      openMediaPicker({ input, selectedNode: selectedMedia, uploadPanel }, libraryButton);
    uploadToggle.onclick = () => {
      uploadPanel.classList.toggle('hidden');
      if (!uploadPanel.classList.contains('hidden')) mediaAlt.focus();
    };
    input.addEventListener('input', () => {
      const knownMedia = mediaLibrary.find((media) => mediaValue(media) === input.value);
      renderSelectedMedia(input, selectedMedia, knownMedia || null);
    });
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        uploadStatus.dataset.kind = 'error';
        uploadStatus.textContent = 'La imagen supera el máximo de 2 MiB.';
        return;
      }
      if (!decorative.checked && !mediaAlt.value.trim()) {
        uploadStatus.dataset.kind = 'error';
        uploadStatus.textContent = 'Añade texto alternativo o marca la imagen como decorativa.';
        return;
      }
      if (!mediaCredit.value.trim() || !mediaLicense.value.trim()) {
        uploadStatus.dataset.kind = 'error';
        uploadStatus.textContent = 'El crédito y la licencia son obligatorios.';
        return;
      }
      uploadStatus.dataset.kind = 'loading';
      uploadStatus.textContent = 'Subiendo ' + file.name + '…';
      picker.disabled = true;
      const localPreviewUrl = URL.createObjectURL(file);
      const previousPreview = input.dataset.previewSrc;
      input.dataset.previewSrc = localPreviewUrl;
      updatePreview();
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const content = String(reader.result).split(',')[1];
          const result = await api('/.netlify/functions/upload-media', {
            method: 'POST',
            body: JSON.stringify({
              name: file.name,
              mimeType: file.type,
              content,
              altText: mediaAlt.value.trim(),
              credit: mediaCredit.value.trim(),
              license: mediaLicense.value.trim(),
              decorative: decorative.checked,
            }),
          });
          const uploaded = result.image;
          input.value = mediaValue(uploaded);
          input.dataset.previewSrc = uploaded.previewUrl || mediaValue(uploaded);
          mediaLibrary = [uploaded, ...mediaLibrary.filter((media) => media.id !== uploaded.id)];
          renderSelectedMedia(input, selectedMedia, uploaded);
          uploadStatus.dataset.kind = 'success';
          uploadStatus.textContent = result.image.existing
            ? 'La imagen ya existía y fue seleccionada.'
            : 'Imagen subida y seleccionada.';
          uploadPanel.classList.add('hidden');
          picker.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (error) {
          if (previousPreview) input.dataset.previewSrc = previousPreview;
          else delete input.dataset.previewSrc;
          updatePreview();
          uploadStatus.dataset.kind = 'error';
          uploadStatus.textContent = error.message;
        } finally {
          picker.disabled = false;
          URL.revokeObjectURL(localPreviewUrl);
        }
      };
      reader.onerror = () => {
        if (previousPreview) input.dataset.previewSrc = previousPreview;
        else delete input.dataset.previewSrc;
        picker.disabled = false;
        URL.revokeObjectURL(localPreviewUrl);
        uploadStatus.dataset.kind = 'error';
        uploadStatus.textContent = 'No se pudo leer el archivo seleccionado.';
        updatePreview();
      };
      reader.readAsDataURL(file);
    };
    uploadPanel.append(uploadTitle, uploadHelp, mediaMetadata, pickerLabel, uploadStatus);
    wrapper.append(help, selectedMedia, mediaActions, uploadPanel);
    renderSelectedMedia(input, selectedMedia);
  }
  return wrapper;
}
function validateEditor() {
  const fields = Array.from(fieldsNode.querySelectorAll('[data-key]'));
  const invalid = fields.filter((field) => !field.checkValidity());
  if (invalid.length) {
    invalid[0].reportValidity();
    invalid[0].focus();
    setStatus('Revisa los campos marcados antes de continuar.', true);
    return false;
  }
  return true;
}

function isPublishedReference(item) {
  if (item?.workflow?.reference_available === false) return false;
  return Boolean(
    item?.workflow?.published_sha ||
    item?.data?.workflow_state === 'published' ||
    item?.data?.draft === false
  );
}

function referenceValue(source, item) {
  if (source === 'categorias' || source === 'etiquetas') {
    return taxonomyReferenceSlug(item.data.slug || item.data.title);
  }
  return item.data.slug || String(item.data.year || item.data.title || '');
}

function syncEntryPageOptions() {
  if (collection.value !== 'entradas') return;
  const simposioInput = fieldsNode.querySelector('[data-key="simposio"]');
  const pageInput = fieldsNode.querySelector('[data-key="page_id"]');
  if (!simposioInput || !pageInput) return;
  const selected = pageInput.value;
  const pages = references.paginas.filter(
    (item) =>
      isPublishedReference(item) &&
      String(item.data.simposio || defaults.simposio) === String(simposioInput.value)
  );
  pageInput.innerHTML = '<option value="">— Sin página asignada —</option>';
  pages.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.data.id;
    option.textContent = item.data.title + (item.data.slug ? ' · /' + item.data.slug : '');
    option.selected = item.data.id === selected;
    pageInput.appendChild(option);
  });
  if (selected && pageInput.value !== selected) {
    pageInput.value = '';
    pageInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function shortSha(value) {
  return value ? String(value).slice(0, 12) : '—';
}
function hasFuturePublishDate(data) {
  const value = String(data?.publish_date || '').trim();
  if (!value) return false;
  const todayInBogota = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return value > todayInBogota;
}
function renderWorkflow(record) {
  const versionNode = document.getElementById('version-info');
  const saveButton = document.getElementById('save-draft-button');
  saveButton.textContent = saveActionLabel(
    current ? { data: current.data, workflow: record || current.workflow } : null
  );
  if (!current || !record) {
    versionNode.classList.add('hidden');
    document.getElementById('publish-button').classList.add('hidden');
    document.getElementById('archive-button').classList.add('hidden');
    return;
  }
  const hasUnpublishedChanges =
    record.current_sha !== record.published_sha ||
    record.reference_available === false ||
    record.deployment_state === 'stale';
  const publicationLabels = {
    idle: hasUnpublishedChanges ? 'Borrador listo' : 'Publicado',
    validating: 'Validando',
    pr_open: 'Publicación en curso',
    merged: 'Desplegando',
    live: 'Publicado',
    archived: 'Archivado',
    failed: 'Error de publicación',
  };
  const scheduled = record.publication_state === 'live' && hasFuturePublishDate(current.data);
  const visiblePublicationLabel = scheduled
    ? `Programado para ${current.data.publish_date}`
    : record.deployment_state === 'failed'
      ? 'El despliegue falló; se reintentará sin duplicar la publicación'
      : record.deployment_state === 'stale'
        ? 'El Markdown publicado no está en GitHub; puedes republicarlo'
        : publicationLabels[record.publication_state] || 'Borrador';
  versionNode.innerHTML =
    '<div class="grid gap-1 sm:grid-cols-2"><span>Versión actual: <code>' +
    esc(shortSha(record.current_sha)) +
    '</code></span><span>Versión publicada: <code>' +
    esc(shortSha(record.published_sha)) +
    '</code></span></div>' +
    '<p class="mt-2 font-semibold ' +
    (record.publication_state === 'failed' ? 'text-red-700' : 'text-ugr-green') +
    '">' +
    esc(visiblePublicationLabel) +
    '</p>';
  versionNode.classList.remove('hidden');
  const publishing = ['queued', 'validating', 'pr_open', 'merged'].includes(
    String(record.publication_state || '')
  );
  const mayPublish = can('publish') && record.current_sha && hasUnpublishedChanges && !publishing;
  document.getElementById('publish-button').classList.toggle('hidden', !mayPublish);
  document.getElementById('publish-button').textContent =
    record.publication_state === 'failed' ? 'Reintentar publicación' : 'Publicar';
  const mayArchive =
    can('archive') &&
    Boolean(record.published_sha) &&
    !publishing &&
    record.workflow_state !== 'archived';
  document.getElementById('archive-button').classList.toggle('hidden', !mayArchive);
}
async function refreshWorkflow() {
  if (!current?.path) return;
  const result = await api(
    '/.netlify/functions/manage-workflow?path=' + encodeURIComponent(current.path)
  );
  current.workflow = result.record;
  current.data.workflow_state = result.record.workflow_state;
  renderWorkflow(result.record);
}
function openEditor(item) {
  current = item || null;
  historyNode.classList.add('hidden');
  historyNode.innerHTML = '';
  emptyEditor.classList.add('hidden');
  editor.classList.remove('hidden');
  collectionView.classList.add('hidden');
  document.getElementById('editor-title').textContent = item
    ? item.data.title || item.name
    : 'Nuevo contenido';
  document.getElementById('file-path').textContent = item
    ? item.path
    : 'El nombre del archivo se generará al guardar.';
  fieldsNode.innerHTML = '';
  const data = { ...defaults, ...(item ? item.data : {}) };
  schemas[collection.value].forEach((def) =>
    fieldsNode.appendChild(fieldElement(def, data[def[0]]))
  );
  if (collection.value === 'entradas') {
    fieldsNode
      .querySelector('[data-key="simposio"]')
      ?.addEventListener('change', syncEntryPageOptions);
    syncEntryPageOptions();
  }
  const blockToolsVisible = collection.value === 'entradas';
  document.getElementById('content-block-tools').classList.toggle('hidden', !blockToolsVisible);
  document.getElementById('content-block-editor').classList.toggle('has-tools', blockToolsVisible);
  document.getElementById('body').value = item ? item.body : '';
  window.dispatchEvent(
    new CustomEvent('cms:body-load', { detail: { body: item ? item.body : '' } })
  );
  document.getElementById('delete-button').classList.toggle('hidden', !item);
  document.getElementById('history-button').classList.toggle('hidden', !item);
  updatePreview();
  dirty = false;
  document.getElementById('save-state').textContent = 'Guardado';
  const recovered = localStorage.getItem(draftStorageKey());
  if (!item && recovered && confirm('Hay un borrador local sin guardar. ¿Quieres recuperarlo?')) {
    try {
      const saved = JSON.parse(recovered);
      Object.entries(saved.data || {}).forEach(([key, value]) => {
        const input = fieldsNode.querySelector('[data-key="' + CSS.escape(key) + '"]');
        if (!input) return;
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = Array.isArray(value) ? value.join(', ') : value;
      });
      if (collection.value === 'entradas') {
        const savedPageId = String(saved.data?.page_id || '');
        syncEntryPageOptions();
        const pageInput = fieldsNode.querySelector('[data-key="page_id"]');
        if (pageInput) pageInput.value = savedPageId;
      }
      document.getElementById('body').value = saved.body || '';
      window.dispatchEvent(
        new CustomEvent('cms:body-load', { detail: { body: saved.body || '' } })
      );
      updatePreview();
    } catch {}
  }
  document.getElementById('delete-button').classList.toggle('hidden', !item || !can('delete'));
  document
    .getElementById('save-draft-button')
    .classList.toggle('hidden', !can(item ? 'update' : 'create'));
  document.getElementById('save-draft-button').textContent = saveActionLabel(item);
  document.getElementById('publish-button').classList.add('hidden');
  document.getElementById('archive-button').classList.add('hidden');
  renderWorkflow(item?.workflow || null);
  if (item) {
    refreshWorkflow().catch((error) => setStatus(error.message, true));
  }
}
function draftStorageKey() {
  return 'cms-editor:' + collection.value + ':' + (current?.path || 'new');
}
function persistLocalDraft() {
  try {
    localStorage.setItem(
      draftStorageKey(),
      JSON.stringify({
        data: formData(),
        body: document.getElementById('body').value,
        savedAt: new Date().toISOString(),
      })
    );
  } catch {}
}
function formData() {
  const data = {};
  fieldsNode.querySelectorAll('[data-key]').forEach((input) => {
    const def = schemas[collection.value].find((field) => field[0] === input.dataset.key);
    if (def[2] === 'boolean') data[input.dataset.key] = input.checked;
    else if (def[2] === 'number') data[input.dataset.key] = Number(input.value || 0);
    else if (def[2] === 'list')
      data[input.dataset.key] = input.value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    else if (def[2].startsWith('relations:'))
      data[input.dataset.key] = Array.from(input.selectedOptions).map((option) => option.value);
    else if (def[2] === 'json') {
      try {
        data[input.dataset.key] = JSON.parse(input.value || '[]');
      } catch {
        throw new Error('El JSON de los elementos del menú no es válido.');
      }
    } else data[input.dataset.key] = input.value.trim();
  });
  return data;
}
const previewMarkdownRenderer = new marked.Renderer();
const defaultPreviewCodeRenderer = previewMarkdownRenderer.code.bind(previewMarkdownRenderer);
previewMarkdownRenderer.code = (token) => {
  const block = parseCmsEditorBlock(token.lang, token.text);
  return block
    ? renderCmsEditorBlockHtml(
        block,
        globalItems.filter((item) => item.collection === 'entradas'),
        {
          excludeSlug: String(current?.path || '')
            .split('/')
            .pop()
            ?.replace(/\.md$/i, ''),
        }
      )
    : defaultPreviewCodeRenderer(token);
};
function markdown(value) {
  const rendered = marked.parse(String(value || ''), {
    async: false,
    breaks: true,
    gfm: true,
    pedantic: false,
    renderer: previewMarkdownRenderer,
  });
  return DOMPurify.sanitize(String(rendered), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}
function updatePreview() {
  if (editor.classList.contains('hidden')) return;
  let data;
  try {
    data = formData();
  } catch {
    previewNode.innerHTML =
      '<p class="p-6 text-amber-700">Completa el campo JSON para actualizar la vista previa.</p>';
    return;
  }
  const body = document.getElementById('body').value;
  const imageInputs = ['image', 'poster', 'instituciones_image']
    .map((key) => fieldsNode.querySelector('[data-key="' + key + '"]'))
    .filter(Boolean);
  const image = imageInputs
    .map((input) => input.dataset.previewSrc || input.value)
    .find((value) => Boolean(value));
  const badges = [...(data.categories || []), ...(data.tags || [])]
    .map(
      (value) =>
        '<span class="rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">' +
        esc(value) +
        '</span>'
    )
    .join(' ');
  const meta = [data.date, data.author, data.place, data.collective]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  const publishedUrl = isPublishedListingContent(current)
    ? getPublicUrl(collection.value, current?.path || '', data)
    : '';
  previewNode.innerHTML =
    (image
      ? '<img src="' + esc(resolvePreviewUrl(image)) + '" alt="" class="h-56 w-full object-cover">'
      : '<div class="h-24 bg-gradient-to-r from-ugr-green to-ugr-green-dark"></div>') +
    '<div class="p-6">' +
    (isArchivedContent(current)
      ? '<p class="mb-2 text-xs font-bold uppercase text-gray-600">Archivada</p>'
      : hasPendingPublishedChanges(current)
        ? '<p class="mb-2 text-xs font-bold uppercase text-amber-700">Cambios sin publicar</p>'
        : !publishedUrl && data.draft
          ? '<p class="mb-2 text-xs font-bold uppercase text-amber-700">Borrador</p>'
          : '') +
    '<h1 class="text-3xl font-bold text-ugr-green-dark">' +
    esc(data.title || 'Título del contenido') +
    '</h1>' +
    (meta ? '<p class="mt-2 text-sm text-gray-500">' + meta + '</p>' : '') +
    (data.description
      ? '<p class="mt-4 text-lg text-gray-700">' + esc(data.description) + '</p>'
      : '') +
    (publishedUrl
      ? '<div class="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">' +
        '<strong class="block mb-1">Publicado</strong>' +
        '<a href="' +
        esc(publishedUrl) +
        '" target="_blank" rel="noopener noreferrer" class="font-semibold text-ugr-green underline">→ ' +
        esc(publishedUrl) +
        '</a>' +
        '</div>'
      : '') +
    (badges ? '<div class="mt-4 flex flex-wrap gap-2">' + badges + '</div>' : '') +
    '<div class="cms-markdown-preview">' +
    markdown(body || 'El contenido escrito en Markdown aparecerá aquí en tiempo real.') +
    '</div></div>';

  previewNode.querySelectorAll('.cms-markdown-preview a').forEach((link) => {
    link.setAttribute('rel', 'noopener noreferrer');
    if (/^https?:\/\//i.test(link.getAttribute('href') || ''))
      link.setAttribute('target', '_blank');
  });
}
async function persistDraft(autosave = false) {
  if (saveInFlight || (autosave && !current)) return false;
  if (!autosave && !validateEditor()) return false;
  saveInFlight = true;
  const generation = changeGeneration;
  const payloadData = formData();
  document.getElementById('save-state').textContent = autosave
    ? 'Guardando automáticamente…'
    : 'Guardando…';
  try {
    const result = await api('/.netlify/functions/manage-content?collection=' + collection.value, {
      method: current ? (autosave ? 'PATCH' : 'PUT') : 'POST',
      body: JSON.stringify({
        path: current?.path,
        sha: current?.sha,
        revision: current?.revision,
        data: payloadData,
        body: document.getElementById('body').value,
        autosave,
      }),
    });
    const detail = await api(
      '/.netlify/functions/manage-content?collection=' +
        collection.value +
        '&path=' +
        encodeURIComponent(result.item.path)
    );
    current = detail.item;
    if (generation === changeGeneration) dirty = false;
    localStorage.removeItem(draftStorageKey());
    document.getElementById('file-path').textContent = current.path;
    document.getElementById('editor-title').textContent = current.data.title || current.name;
    document.getElementById('delete-button').classList.toggle('hidden', !can('delete'));
    document.getElementById('history-button').classList.remove('hidden');
    document.getElementById('save-state').textContent = dirty ? 'Cambios sin guardar' : 'Guardado';
    renderWorkflow(current.workflow);
    if (!autosave) {
      setStatus(
        hasPublishedVersion(current)
          ? 'Cambios guardados en Supabase.'
          : 'Borrador guardado en Supabase.'
      );
    }
    return true;
  } catch (error) {
    setStatus(error.message, true);
    document.getElementById('save-state').textContent = 'No se pudo guardar';
    return false;
  } finally {
    saveInFlight = false;
    if (dirty && current) {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => persistDraft(true), 2000);
    }
  }
}
editor.addEventListener('submit', async (event) => {
  event.preventDefault();
  await persistDraft(false);
});
document.getElementById('delete-button').onclick = async () => {
  if (!current || !confirm('¿Eliminar este borrador de Supabase?')) return;
  try {
    await api(
      '/.netlify/functions/manage-content?collection=' +
        collection.value +
        '&path=' +
        encodeURIComponent(current.path) +
        '&revision=' +
        current.revision,
      { method: 'DELETE' }
    );
    setStatus('Contenido eliminado.');
    await loadItems();
  } catch (error) {
    setStatus(error.message, true);
  }
};
document.getElementById('history-button').onclick = async () => {
  if (!current) return;
  historyNode.classList.remove('hidden');
  historyNode.innerHTML = '<p>Cargando historial…</p>';
  try {
    const result = await api(
      '/.netlify/functions/get-revision-history?path=' + encodeURIComponent(current.path)
    );
    historyNode.innerHTML =
      '<div class="mb-4 flex justify-between"><h2 class="text-xl font-semibold">Historial de revisiones</h2><button id="close-history" class="text-ugr-green">Volver al editor</button></div>' +
      (result.revisions || [])
        .map(
          (revision) =>
            '<div class="mb-2 block rounded-lg border border-gray-200 p-3"><strong>' +
            esc(revision.message) +
            '</strong><br><span class="text-xs text-gray-500">' +
            esc(revision.author) +
            ' · ' +
            esc(new Date(revision.date).toLocaleString()) +
            '</span></div>'
        )
        .join('');
    editor.classList.add('hidden');
    document.getElementById('close-history').onclick = () => {
      historyNode.classList.add('hidden');
      editor.classList.remove('hidden');
    };
  } catch (error) {
    historyNode.innerHTML = '<p class="text-red-700">' + esc(error.message) + '</p>';
  }
};
document.getElementById('new-button').onclick = () => openEditor(null);
document.getElementById('header-new-button').onclick = () => openEditor(null);
document.getElementById('back-button').onclick = loadItems;
document.getElementById('save-draft-button').onclick = () => persistDraft(false);
document.getElementById('publish-button').onclick = () => transition('publish');
document.getElementById('archive-button').onclick = () => {
  if (confirm('¿Archivar este contenido y retirarlo del sitio público?')) transition('archive');
};
async function transition(name) {
  if (!current && !(await persistDraft(false))) return;
  try {
    if (dirty && !(await persistDraft(false))) return;
    document.getElementById('publish-button').disabled = true;
    document.getElementById('archive-button').disabled = true;
    document.getElementById('save-state').textContent =
      name === 'archive' ? 'Preparando archivo…' : 'Preparando publicación…';
    const result = await api('/.netlify/functions/manage-workflow', {
      method: 'POST',
      body: JSON.stringify({
        path: current.path,
        transition: name,
        operationKey: crypto.randomUUID(),
      }),
    });
    setStatus(
      result.idempotent && ['published', 'archived'].includes(result.state)
        ? name === 'archive'
          ? 'Este contenido ya está archivado.'
          : 'Esta versión ya está publicada.'
        : name === 'archive'
          ? 'Archivo en curso. El contenido desaparecerá cuando Netlify confirme el despliegue.'
          : 'Publicación en curso. El CMS validará el contenido y actualizará el sitio automáticamente.'
    );
    document.getElementById('save-state').textContent =
      name === 'archive' ? 'Archivo en curso…' : 'Publicación en curso…';
    await refreshWorkflow();
    pollPublication(0);
  } catch (error) {
    setStatus(error.message, true);
    document.getElementById('save-state').textContent = 'Error de publicación';
  } finally {
    document.getElementById('publish-button').disabled = false;
    document.getElementById('archive-button').disabled = false;
  }
}
async function pollPublication(attempt) {
  if (!current) return;
  if (attempt >= 36) {
    document.getElementById('save-state').textContent = 'Publicación pendiente';
    setStatus(
      'La publicación continúa en segundo plano. Puedes seguir trabajando y volver más tarde; no necesitas mantener esta página abierta.'
    );
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
  try {
    await refreshWorkflow();
    const state = current.workflow?.publication_state;
    if (current.workflow?.deployment_state === 'failed') {
      document.getElementById('save-state').textContent = 'Error de despliegue';
      setStatus(
        current.workflow?.publication_error ||
          'Netlify rechazó este despliegue. El CMS conservará el merge y podrá reconciliar un reintento.',
        true
      );
      return;
    }
    if (state === 'live') {
      const scheduled = hasFuturePublishDate(current.data);
      document.getElementById('save-state').textContent = scheduled ? 'Programado' : 'Publicado';
      setStatus(
        scheduled
          ? `Contenido programado para ${current.data.publish_date}; se activará con el rebuild diario.`
          : 'Contenido publicado y confirmado en Netlify.'
      );
      await loadReferences();
      checkDeployment();
      return;
    }
    if (state === 'archived') {
      document.getElementById('save-state').textContent = 'Archivado';
      setStatus('Contenido retirado del sitio y confirmado en Netlify.');
      return;
    }
    if (state === 'pr_open') {
      document.getElementById('save-state').textContent = 'Validando publicación…';
      setStatus('Validando el contenido. Puedes seguir trabajando mientras termina el proceso.');
    }
    if (state === 'merged') {
      document.getElementById('save-state').textContent = 'Actualizando el sitio…';
      setStatus(
        'La versión fue fusionada en GitHub. Netlify todavía está actualizando el sitio público; se mostrará como publicada cuando el deploy sea confirmado.'
      );
    }
    if (state === 'failed') {
      document.getElementById('save-state').textContent = 'Error de publicación';
      setStatus(
        current.workflow?.publication_error ||
          'La validación técnica falló. Corrige la causa y pulsa Reintentar publicación.',
        true
      );
      return;
    }
  } catch {}
  pollPublication(attempt + 1);
}
editor.addEventListener('input', () => {
  dirty = true;
  changeGeneration += 1;
  document.getElementById('save-state').textContent = 'Cambios sin guardar';
  updatePreview();
  clearTimeout(localDraftTimer);
  localDraftTimer = setTimeout(persistLocalDraft, 700);
  clearTimeout(autosaveTimer);
  if (current) autosaveTimer = setTimeout(() => persistDraft(true), 2000);
});
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
collection.onchange = () => {
  createNavigation();
  loadItems();
};
search.oninput = renderItems;
draftsOnly.onchange = renderItems;
sortSelect.onchange = renderItems;
document.getElementById('sort-visible').onchange = (event) => {
  sortSelect.value = event.target.value;
  renderItems();
};
document.getElementById('group').onchange = renderItems;
document.getElementById('view-list').onclick = () => {
  gridView = false;
  renderItems();
};
document.getElementById('view-grid').onclick = () => {
  gridView = true;
  renderItems();
};
document.getElementById('view-list-visible').onclick = () => {
  gridView = false;
  renderItems();
};
document.getElementById('view-grid-visible').onclick = () => {
  gridView = true;
  renderItems();
};
document.querySelectorAll('[data-draft-collection]').forEach(
  (button) =>
    (button.onclick = () => {
      collection.value = button.dataset.draftCollection;
      draftsOnly.checked = true;
      createNavigation();
      loadItems();
    })
);
function start() {
  window.supabaseAuth.ready.then(async () => {
    if (await window.supabaseAuth.getUser()) {
      const requested = new URLSearchParams(location.search).get('collection');
      if (requested && labels[requested]) collection.value = requested;
      document.getElementById('workspace').classList.remove('hidden');
      collectionNav.classList.remove('hidden');
      collectionNav.classList.add('flex');
      createNavigation();
      await loadReferences();
      const query = new URLSearchParams(location.search);
      draftsOnly.checked = query.get('drafts') === '1';
      await loadItems();
      checkDeployment();
      if (query.get('new') === '1') openEditor(null);
    }
  });
}
waitForAdminAuth()
  .then(start)
  .catch((error) => setStatus(error.message, 'error'));
