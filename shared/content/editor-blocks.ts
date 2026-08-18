export const CMS_BLOCK_LANGS = ['cms-image', 'cms-gallery', 'cms-entries'] as const;

type CmsImage = {
  src: string;
  alt: string;
  caption?: string;
  credit?: string;
  license?: string;
};

export type CmsEditorBlock =
  | { type: 'image'; image: CmsImage }
  | { type: 'gallery'; images: CmsImage[]; layout: 'grid' | 'carousel' }
  | { type: 'entries'; category: string; limit: number; layout: 'grid' | 'carousel' };

export type CmsBlockEntry = {
  id?: unknown;
  path?: unknown;
  collection?: unknown;
  data?: {
    title?: unknown;
    description?: unknown;
    image?: unknown;
    categories?: unknown;
    date?: unknown;
    publish_date?: unknown;
    draft?: unknown;
  };
};

function text(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function mediaUrl(value: unknown): string {
  const candidate = text(value, 2048);
  if (
    /^https:\/\/[^\s]+$/i.test(candidate) ||
    /^\/images\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(candidate)
  ) {
    return candidate;
  }
  return '';
}

function imageValue(value: unknown): CmsImage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const src = mediaUrl(source.src);
  if (!src) return null;
  return {
    src,
    alt: text(source.alt, 500),
    ...(text(source.caption, 1000) ? { caption: text(source.caption, 1000) } : {}),
    ...(text(source.credit, 500) ? { credit: text(source.credit, 500) } : {}),
    ...(text(source.license, 200) ? { license: text(source.license, 200) } : {}),
  };
}

export function parseCmsEditorBlock(language: unknown, source: unknown): CmsEditorBlock | null {
  const lang = text(language, 40).toLowerCase();
  if (!(CMS_BLOCK_LANGS as readonly string[]).includes(lang) || typeof source !== 'string') {
    return null;
  }

  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  if (lang === 'cms-image') {
    const image = imageValue(value);
    return image ? { type: 'image', image } : null;
  }

  if (lang === 'cms-gallery') {
    const images = Array.isArray(value.images)
      ? value.images
          .map(imageValue)
          .filter((image): image is CmsImage => Boolean(image))
          .slice(0, 24)
      : [];
    if (!images.length) return null;
    return {
      type: 'gallery',
      images,
      layout: value.layout === 'carousel' ? 'carousel' : 'grid',
    };
  }

  const category = text(value.category, 120);
  if (!category) return null;
  const requestedLimit = Number(value.limit);
  const limit = Number.isInteger(requestedLimit) ? Math.min(12, Math.max(1, requestedLimit)) : 6;
  return {
    type: 'entries',
    category,
    limit,
    layout: value.layout === 'carousel' ? 'carousel' : 'grid',
  };
}

export function cmsEditorBlockErrors(markdown: unknown): string[] {
  if (typeof markdown !== 'string') return [];
  const errors: string[] = [];
  const openingFence = /^```(cms-[a-z-]+)\s*$/gim;
  let opening;
  while ((opening = openingFence.exec(markdown))) {
    const closingFence = /^```\s*$/gm;
    closingFence.lastIndex = openingFence.lastIndex;
    const closing = closingFence.exec(markdown);
    if (!closing) {
      errors.push(`El bloque ${opening[1]} no está cerrado.`);
      break;
    }
    const source = markdown.slice(openingFence.lastIndex, closing.index).replace(/^\r?\n/, '');
    if (!(CMS_BLOCK_LANGS as readonly string[]).includes(opening[1].toLowerCase())) {
      errors.push(`El bloque ${opening[1]} no está permitido.`);
    } else if (!parseCmsEditorBlock(opening[1], source)) {
      errors.push(`El bloque ${opening[1]} tiene una configuración inválida.`);
    }
    openingFence.lastIndex = closingFence.lastIndex;
  }
  return errors;
}

export function serializeCmsEditorBlock(block: CmsEditorBlock): string {
  const language = `cms-${block.type}`;
  const value =
    block.type === 'image'
      ? block.image
      : block.type === 'gallery'
        ? { layout: block.layout, images: block.images }
        : { category: block.category, limit: block.limit, layout: block.layout };
  return `\`\`\`${language}\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function imageCaption(image: CmsImage): string {
  return [image.caption, image.credit, image.license].filter(Boolean).join(' · ');
}

function renderImage(image: CmsImage, className = ''): string {
  const caption = imageCaption(image);
  return `<figure class="cms-rich-image ${escapeHtml(className)}"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
}

function entrySlug(entry: CmsBlockEntry): string {
  const path = text(entry.path, 500);
  if (path) return path.split('/').pop()?.replace(/\.md$/i, '') || '';
  return text(entry.id, 200);
}

function entryDate(entry: CmsBlockEntry): string {
  const raw = text(entry.data?.publish_date || entry.data?.date, 40);
  if (!raw) return '';
  const date = new Date(`${raw.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(date);
}

function renderEntryCard(entry: CmsBlockEntry): string {
  const slug = entrySlug(entry);
  const title = text(entry.data?.title, 300) || slug;
  const description = text(entry.data?.description, 500);
  const image = mediaUrl(entry.data?.image);
  const date = entryDate(entry);
  return `<article class="cms-rich-entry-card">${image ? `<a href="/entradas/${encodeURIComponent(slug)}"><img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async"></a>` : ''}<div>${date ? `<p class="cms-rich-entry-date">${escapeHtml(date)}</p>` : ''}<h3><a href="/entradas/${encodeURIComponent(slug)}">${escapeHtml(title)}</a></h3>${description ? `<p>${escapeHtml(description)}</p>` : ''}<a class="cms-rich-entry-link" href="/entradas/${encodeURIComponent(slug)}">Leer entrada →</a></div></article>`;
}

export function renderCmsEditorBlockHtml(
  block: CmsEditorBlock,
  entries: CmsBlockEntry[] = [],
  options: { excludeSlug?: string } = {}
): string {
  if (block.type === 'image') {
    return `<div class="cms-rich-block cms-rich-block-image">${renderImage(block.image)}</div>`;
  }

  if (block.type === 'gallery') {
    return `<section class="cms-rich-block cms-rich-gallery" data-layout="${block.layout}" aria-label="Galería de imágenes"><div class="cms-rich-gallery-track">${block.images.map((image) => renderImage(image)).join('')}</div></section>`;
  }

  const matching = entries
    .filter((entry) => {
      const categories = Array.isArray(entry.data?.categories) ? entry.data?.categories : [];
      return (
        entrySlug(entry) !== options.excludeSlug &&
        entry.data?.draft !== true &&
        categories.some((category) => String(category) === block.category)
      );
    })
    .sort((left, right) =>
      text(right.data?.publish_date || right.data?.date).localeCompare(
        text(left.data?.publish_date || left.data?.date)
      )
    )
    .slice(0, block.limit);

  return `<section class="cms-rich-block cms-rich-entries" data-layout="${block.layout}" aria-label="Entradas de la categoría ${escapeHtml(block.category)}"><header><p>Explorar contenidos</p><h2>${escapeHtml(block.category)}</h2></header>${matching.length ? `<div class="cms-rich-entries-track">${matching.map(renderEntryCard).join('')}</div>` : '<p class="cms-rich-empty">Todavía no hay entradas publicadas en esta categoría.</p>'}</section>`;
}
