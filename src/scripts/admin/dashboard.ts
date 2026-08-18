// @ts-nocheck
import { waitForAdminAuth } from './client.ts';
const loading = document.getElementById('admin-loading');
const dashboard = document.getElementById('admin-dashboard');

function showDashboard() {
  window.supabaseAuth?.getUser().then(function (user) {
    loading?.classList.add('hidden');
    dashboard?.classList.toggle('hidden', !user);
    if (user) {
      const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'bienvenido/a';
      document.getElementById('welcome-name').textContent = name.split(/\s+/)[0];
      const query = new URLSearchParams(location.search);
      const manual = query.get('tour') === '1';
      const completed = localStorage.getItem('cms_tour_completed') === '1';
      const suppressed = localStorage.getItem('cms_tour_suppressed') === '1';
      if (manual || (!completed && !suppressed)) window.setTimeout(openTour, 350);
    }
  });
}

waitForAdminAuth()
  .then(showDashboard)
  .catch(() => loading?.classList.add('hidden'));
window.addEventListener('supabase-auth', showDashboard);

const steps = [
  [
    'Bienvenido/a al CMS',
    'Este panel administra los contenidos de la Red Internacional de Memorias Participativas. Trabajarás con entradas, memorias, páginas, ediciones, categorías, etiquetas e imágenes. Cada operación se valida con tu sesión y tus permisos de Supabase.',
  ],
  [
    'La pantalla de bienvenida',
    'Después de iniciar sesión llegarás siempre a Inicio. Aquí encontrarás accesos para crear una entrada, añadir una memoria, revisar borradores, gestionar contenidos y abrir las herramientas administrativas. Pulsa el logotipo o “Inicio” para regresar.',
  ],
  [
    'Navegación superior',
    'La barra superior permite abrir directamente Entradas, Memorias y Páginas. El botón Tema alterna el modo claro y oscuro. El avatar muestra Inicio, esta Guía de uso y Cerrar sesión. El tema seleccionado queda guardado en este navegador.',
  ],
  [
    'Menú lateral y búsqueda global',
    'Dentro de Gestión de contenidos, el menú lateral separa contenido, borradores, taxonomías y administración. El buscador superior consulta todas las colecciones: escribe parte de un título y selecciona el resultado para abrirlo en el editor.',
  ],
  [
    'Listados de contenido',
    'Cada colección tiene una cabecera con descripción y un botón para crear. Puedes ordenar por título, fecha o número, agrupar por campos como autor, lugar, colectivo, plantilla o estado, y alternar entre tarjetas y lista. Las tarjetas muestran título e imagen destacada.',
  ],
  [
    'Crear una entrada',
    'Abre Entradas y pulsa “Nueva entrada”. Indica título, edición del simposio, fecha, autoría, categorías, etiquetas, imagen y extracto. El cuerpo admite Markdown. Si dejas la fecha vacía, el servidor asignará automáticamente la fecha actual al guardar.',
  ],
  [
    'Añadir una memoria',
    'Abre Memorias y pulsa “Nueva memoria”. El número, título y lugar son obligatorios. También puedes registrar autoría, colectivo, clasificación, imagen, descripción breve y texto completo. El número es una referencia pública y forma parte de la URL; la identidad técnica es un UUID generado por el servidor.',
  ],
  [
    'Crear y organizar páginas',
    'Las Páginas contienen información estable del sitio. Selecciona la edición, slug, página superior, plantilla y orden. “Página superior” permite construir jerarquías. “Portada del sitio” debe marcarse únicamente en la página que actuará como inicio.',
  ],
  [
    'Gestionar ediciones del simposio',
    'En Ediciones puedes registrar año, número de edición, fecha, lugar, estado, tema, cabecera, cartel y programa. El estado puede ser active, upcoming o archived. Mantén una sola edición como predeterminada para evitar rutas y enlaces ambiguos.',
  ],
  [
    'Categorías jerárquicas',
    'Las categorías clasifican entradas y memorias. Crea un título y, si lo necesitas, selecciona una categoría superior para formar una jerarquía. El slug forma parte de la referencia legible; la identidad técnica es un UUID generado por el servidor.',
  ],
  [
    'Etiquetas',
    'Las etiquetas son palabras clave planas, sin jerarquía. Primero créalas en Etiquetas y después selecciónalas desde una entrada o memoria. Los selectores guardan el slug, eliminan opciones vacías y evitan valores duplicados.',
  ],
  [
    'Editor y vista previa en tiempo real',
    'Mientras completas los campos, el panel derecho actualiza título, metadatos, imagen, extracto, categorías, etiquetas y cuerpo Markdown. La vista previa no guarda cambios: úsala para revisar la composición antes de pulsar Guardar borrador o Publicar.',
  ],
  [
    'Biblioteca de medios',
    'Puedes subir únicamente JPEG, PNG, WebP o PDF, con un máximo de 2 MiB. Para imágenes debes indicar crédito, licencia y texto alternativo, o marcarlas como decorativas. La biblioteca copia la URL estable de Storage y solo permite eliminar con media.delete.',
  ],
  [
    'Guardar como borrador',
    'Pulsa “Guardar borrador” para conservar el trabajo sin mostrarlo en el sitio público. Los borradores aparecen en las tres secciones laterales y en el panel flotante de borradores recientes. Puedes abrirlos, continuar editando y publicarlos posteriormente.',
  ],
  [
    'Publicar y programar',
    'Pulsa “Publicar” para cambiar draft a false. Esta acción exige el permiso específico de publicación. Si defines una Fecha de programación futura, el archivo queda publicado en el CMS pero el sitio lo mantiene oculto hasta que llegue ese momento.',
  ],
  [
    'Historial y conflictos de edición',
    'En un contenido existente, “Historial” muestra los commits del archivo, autor, fecha y enlace a GitHub. El CMS conserva la versión SHA cargada; si otra persona modifica el archivo antes de tu guardado, recibirás un conflicto y deberás actualizar antes de reintentar.',
  ],
  [
    'Usuarios, roles y permisos',
    'Usuarios y roles permite asignar perfiles superadmin, admin, editor, reviewer, author y read_only. Los permisos determinan quién puede leer, crear, actualizar, publicar o eliminar. El servidor comprueba estos permisos en Supabase; ocultar un botón nunca sustituye esa validación.',
  ],
  [
    'Auditoría y operaciones seguras',
    'Las funciones registran autenticación, autorización y cambios importantes con un identificador de solicitud. Las eliminaciones piden confirmación y las credenciales de GitHub permanecen en el servidor. Si aparece un error, conserva el requestId para localizarlo en los logs.',
  ],
  [
    'Ya puedes empezar',
    'Comienza desde una acción frecuente o abre una colección en la barra superior. Puedes repetir esta explicación en cualquier momento desde avatar → Guía de uso. Si eliges “No mostrar automáticamente otra vez”, la guía seguirá disponible manualmente en ese menú.',
  ],
];
let tourIndex = 0;
const tour = document.getElementById('cms-tour');
function renderTour() {
  const step = steps[tourIndex];
  document.getElementById('tour-step').textContent =
    'Guía de inicio · ' + (tourIndex + 1) + ' de ' + steps.length;
  document.getElementById('tour-title').textContent = step[0];
  document.getElementById('tour-text').textContent = step[1];
  document.getElementById('tour-progress').style.width =
    ((tourIndex + 1) / steps.length) * 100 + '%';
  document.getElementById('tour-back').style.visibility = tourIndex ? 'visible' : 'hidden';
  document.getElementById('tour-next').textContent =
    tourIndex === steps.length - 1 ? 'Terminar' : 'Siguiente';
}
function openTour() {
  tourIndex = 0;
  tour.classList.remove('hidden');
  renderTour();
}
function closeTour(completed = false) {
  if (completed) localStorage.setItem('cms_tour_completed', '1');
  if (document.getElementById('tour-suppress').checked)
    localStorage.setItem('cms_tour_suppressed', '1');
  tour.classList.add('hidden');
  history.replaceState({}, '', location.pathname);
}
document.getElementById('open-tour').onclick = openTour;
document.getElementById('tour-skip').onclick = () => closeTour(false);
document.getElementById('tour-back').onclick = () => {
  if (tourIndex) {
    tourIndex--;
    renderTour();
  }
};
document.getElementById('tour-next').onclick = () => {
  if (tourIndex < steps.length - 1) {
    tourIndex++;
    renderTour();
  } else closeTour(true);
};
tour.addEventListener('click', (event) => {
  if (event.target === tour) closeTour(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !tour.classList.contains('hidden')) closeTour(false);
});
