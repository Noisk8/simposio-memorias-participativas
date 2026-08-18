export const schemas = {
  entradas: [
    ['simposio', 'Simposio', 'relation:simposios'],
    ['page_id', 'Página donde aparecerá', 'relation:paginas'],
    ['title', 'Título', 'text', 'required'],
    ['date', 'Fecha', 'date'],
    ['publish_date', 'Fecha de publicación (programa si es futura)', 'date'],
    ['author', 'Autoría', 'text'],
    ['author_type', 'Tipo de autoría', 'select:Person|Organization'],
    ['categories', 'Categorías', 'relations:categorias'],
    ['tags', 'Etiquetas', 'relations:etiquetas'],
    ['image', 'Imagen (URL de medios)', 'text'],
    ['description', 'Descripción', 'textarea'],
  ],
  memorias: [
    ['simposio', 'Simposio', 'relation:simposios'],
    ['number', 'Número', 'number', 'required'],
    ['title', 'Título', 'text', 'required'],
    ['place', 'Lugar', 'text', 'required'],
    ['author', 'Autoría', 'text'],
    ['collective', 'Colectivo', 'text'],
    ['categories', 'Categorías', 'relations:categorias'],
    ['tags', 'Etiquetas', 'relations:etiquetas'],
    ['image', 'Imagen (URL de medios)', 'text'],
    ['description', 'Descripción', 'textarea'],
    ['publish_date', 'Fecha de publicación (programa si es futura)', 'date'],
  ],
  paginas: [
    ['simposio', 'Simposio', 'relation:simposios'],
    ['slug', 'Slug', 'text'],
    ['parent', 'Página superior', 'relation:paginas'],
    ['is_home', 'Es portada', 'boolean'],
    ['order', 'Orden', 'number'],
    ['template', 'Plantilla', 'select:default|el-simposio|organizacion|programa|contacto|custom'],
    ['title', 'Título', 'text', 'required'],
    ['description', 'Descripción', 'textarea'],
    ['image', 'Imagen', 'text'],
    ['email', 'Email', 'text'],
    ['instagram', 'Instagram URL', 'text'],
    ['instagram_handle', 'Usuario de Instagram', 'text'],
    ['organizadores', 'Organizadores (separados por coma)', 'list'],
    ['instituciones_image', 'Imagen de instituciones', 'text'],
  ],
  simposios: [
    ['title', 'Título', 'text', 'required'],
    ['slug', 'Slug', 'text', 'required'],
    ['edition', 'Edición', 'number', 'required'],
    ['year', 'Año', 'number', 'required'],
    ['date', 'Fecha', 'date'],
    ['place', 'Lugar', 'text'],
    ['status', 'Estado', 'select:active|archived|upcoming'],
    ['theme', 'Tema', 'text'],
    ['image', 'Imagen', 'text'],
    ['poster', 'Cartel', 'text'],
    ['program_url', 'URL del programa', 'text'],
    ['is_default', 'Predeterminado', 'boolean'],
  ],
  categorias: [
    ['title', 'Título', 'text', 'required'],
    ['slug', 'Slug', 'text'],
    ['description', 'Descripción', 'textarea'],
    ['parent', 'Categoría superior', 'relation:categorias'],
  ],
  etiquetas: [
    ['title', 'Título', 'text', 'required'],
    ['slug', 'Slug', 'text'],
    ['description', 'Descripción', 'textarea'],
  ],
};
export const defaults = {
  draft: true,
  simposio: '2026',
  status: 'active',
  template: 'default',
  is_home: false,
  is_default: false,
  order: 0,
  categories: [],
  tags: [],
  organizadores: [],
};
export const labels = {
  entradas: 'Entradas',
  memorias: 'Memorias',
  paginas: 'Páginas',
  simposios: 'Ediciones',
  categorias: 'Categorías',
  etiquetas: 'Etiquetas',
};
export const descriptions = {
  entradas:
    'Entradas o noticias del sitio (equivalente a Posts de WordPress). Se listan las publicadas y las archivadas; los borradores están en la sección Borradores.',
  memorias:
    'Proyectos del Museo de Memorias Vivas, organizados por número, lugar, autoría y colectivo.',
  paginas:
    'Páginas informativas de cada simposio: El Simposio, Organización, Programa, Contacto y otras.',
  simposios:
    'Cada edición de la Red Internacional de Memorias Participativas. Una edición puede ser la activa por defecto.',
  categorias: 'Taxonomía jerárquica para clasificar entradas y memorias.',
  etiquetas: 'Taxonomía plana de palabras clave para entradas y memorias.',
};
export const groupFields = {
  entradas: [
    ['author', 'Autor/a'],
    ['date', 'Mes de publicación'],
  ],
  memorias: [
    ['place', 'Lugar'],
    ['collective', 'Colectivo'],
  ],
  paginas: [
    ['simposio', 'Simposio'],
    ['template', 'Plantilla'],
  ],
  simposios: [['status', 'Estado']],
  categorias: [['parent', 'Categoría padre']],
  etiquetas: [],
};
