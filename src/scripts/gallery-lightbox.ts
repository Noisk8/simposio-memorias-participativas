interface GalleryItem {
  src: string;
  alt: string;
  caption: string;
  figure: HTMLElement;
}

interface GalleryGroup {
  id: string;
  title: string;
  items: GalleryItem[];
}

type CreativeLayout = 'mosaic' | 'masonry' | 'grid';

class GalleryLightbox {
  private groups: Map<string, GalleryGroup> = new Map();
  private currentGroup: GalleryGroup | null = null;
  private currentIndex = 0;
  private overlay: HTMLElement | null = null;
  private imgElement: HTMLImageElement | null = null;
  private titleElement: HTMLElement | null = null;
  private counterElement: HTMLElement | null = null;
  private captionElement: HTMLElement | null = null;
  private thumbnailsTrack: HTMLElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private fullscreenBtn: HTMLButtonElement | null = null;
  private triggerElement: HTMLElement | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private activeLayout: CreativeLayout = 'mosaic';

  constructor() {
    this.init();
  }

  private init() {
    this.createLightboxDOM();
    this.bindGalleries();
    this.injectLayoutSwitchers();
    this.bindEvents();
  }

  private createLightboxDOM() {
    const existing = document.getElementById('cms-gallery-lightbox');
    if (existing) {
      this.overlay = existing;
      this.cacheDOMElements();
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'cms-gallery-lightbox';
    overlay.className = 'cms-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Visor de galería de arte');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="cms-lightbox-backdrop" data-action="close"></div>
      <div class="cms-lightbox-container">
        <header class="cms-lightbox-header">
          <div class="cms-lightbox-title-wrap">
            <span class="cms-lightbox-badge">Exposición</span>
            <span class="cms-lightbox-title">Galería</span>
            <span class="cms-lightbox-counter">1 / 1</span>
          </div>
          <div class="cms-lightbox-controls">
            <button type="button" class="cms-lightbox-btn cms-lightbox-fs" data-action="fullscreen" aria-label="Pantalla completa" title="Pantalla completa">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
              </svg>
            </button>
            <button type="button" class="cms-lightbox-btn cms-lightbox-close" data-action="close" aria-label="Cerrar visor (Esc)" title="Cerrar (Esc)">
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </header>

        <main class="cms-lightbox-stage">
          <button type="button" class="cms-lightbox-btn cms-lightbox-nav cms-lightbox-prev" data-action="prev" aria-label="Imagen anterior (Flecha izquierda)" title="Anterior (←)">
            <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <div class="cms-lightbox-figure-wrap" data-action="backdrop-close">
            <figure class="cms-lightbox-figure">
              <div class="cms-lightbox-img-box">
                <img class="cms-lightbox-img" src="" alt="" />
              </div>
              <figcaption class="cms-lightbox-caption"></figcaption>
            </figure>
          </div>

          <button type="button" class="cms-lightbox-btn cms-lightbox-nav cms-lightbox-next" data-action="next" aria-label="Siguiente imagen (Flecha derecha)" title="Siguiente (→)">
            <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </main>

        <footer class="cms-lightbox-footer">
          <div class="cms-lightbox-thumbs-container">
            <div class="cms-lightbox-thumbs-track"></div>
          </div>
        </footer>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.cacheDOMElements();
  }

  private cacheDOMElements() {
    if (!this.overlay) return;
    this.imgElement = this.overlay.querySelector('.cms-lightbox-img');
    this.titleElement = this.overlay.querySelector('.cms-lightbox-title');
    this.counterElement = this.overlay.querySelector('.cms-lightbox-counter');
    this.captionElement = this.overlay.querySelector('.cms-lightbox-caption');
    this.thumbnailsTrack = this.overlay.querySelector('.cms-lightbox-thumbs-track');
    this.prevBtn = this.overlay.querySelector('.cms-lightbox-prev');
    this.nextBtn = this.overlay.querySelector('.cms-lightbox-next');
    this.fullscreenBtn = this.overlay.querySelector('.cms-lightbox-fs');
  }

  private getGroupInfo(galleryEl: HTMLElement, defaultIndex: number): { id: string; title: string } {
    let prev = galleryEl.previousElementSibling;
    while (prev) {
      if (/^H[1-6]$/i.test(prev.tagName)) {
        const title = prev.textContent?.trim() || 'Galería fotográfica';
        const id = prev.id || `group-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        return { id, title };
      }
      prev = prev.previousElementSibling;
    }
    return { id: `gallery-${defaultIndex}`, title: 'Galería fotográfica' };
  }

  private bindGalleries() {
    this.groups.clear();
    const galleries = Array.from(document.querySelectorAll<HTMLElement>('.cms-rich-gallery'));

    // Apply active layout style
    galleries.forEach((gallery) => {
      gallery.setAttribute('data-creative-layout', this.activeLayout);
    });

    galleries.forEach((galleryEl, gIdx) => {
      const { id: groupId, title: groupTitle } = this.getGroupInfo(galleryEl, gIdx);

      if (!this.groups.has(groupId)) {
        this.groups.set(groupId, { id: groupId, title: groupTitle, items: [] });
      }

      const group = this.groups.get(groupId)!;
      const figures = Array.from(galleryEl.querySelectorAll<HTMLElement>('.cms-rich-image'));

      figures.forEach((figure) => {
        const img = figure.querySelector<HTMLImageElement>('img');
        if (!img) return;

        const src = img.currentSrc || img.src;
        const alt = img.alt || '';
        const captionEl = figure.querySelector('figcaption');
        const caption = captionEl?.textContent?.trim() || alt;

        const itemIndex = group.items.length;
        group.items.push({ src, alt, caption, figure });

        figure.setAttribute('role', 'button');
        figure.setAttribute('tabindex', '0');
        figure.setAttribute('aria-label', `Ampliar imagen: ${alt || 'Fotografía de galería'}`);

        // Archival number stamp (e.g. 01, 02...)
        if (!figure.querySelector('.cms-gallery-index-stamp')) {
          const stamp = document.createElement('span');
          stamp.className = 'cms-gallery-index-stamp';
          stamp.setAttribute('aria-hidden', 'true');
          stamp.textContent = String(itemIndex + 1).padStart(2, '0');
          figure.appendChild(stamp);
        }

        // Editorial hover overlay
        if (!figure.querySelector('.cms-gallery-hover-overlay')) {
          const overlay = document.createElement('div');
          overlay.className = 'cms-gallery-hover-overlay';
          overlay.setAttribute('aria-hidden', 'true');
          overlay.innerHTML = `
            <div class="cms-gallery-hover-content">
              <span class="cms-gallery-hover-cta">
                <svg class="w-3.5 h-3.5 inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
                Ver imagen
              </span>
              ${caption ? `<p class="cms-gallery-hover-caption">${caption}</p>` : ''}
            </div>
          `;
          figure.appendChild(overlay);
        }

        const openHandler = (e: Event) => {
          e.preventDefault();
          this.triggerElement = figure;
          this.open(group, itemIndex);
        };

        figure.addEventListener('click', openHandler);
        figure.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            openHandler(e);
          }
        });
      });
    });

    // Standalone single-image lightboxes
    const singleTriggers = Array.from(document.querySelectorAll<HTMLElement>('[data-lightbox-single]'));
    singleTriggers.forEach((trigger, idx) => {
      const img = trigger.querySelector<HTMLImageElement>('img');
      if (!img) return;
      const src = img.currentSrc || img.src;
      const alt = img.alt || '';
      const title = trigger.dataset.title || alt || 'Imagen';
      const caption = trigger.dataset.caption || alt;

      const singleGroup: GalleryGroup = {
        id: `single-${idx}`,
        title,
        items: [{ src, alt, caption, figure: trigger }],
      };

      trigger.setAttribute('role', 'button');
      trigger.setAttribute('tabindex', '0');
      trigger.style.cursor = 'pointer';

      const openHandler = (e: Event) => {
        e.preventDefault();
        this.triggerElement = trigger;
        this.open(singleGroup, 0);
      };

      trigger.addEventListener('click', openHandler);
      trigger.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          openHandler(e);
        }
      });
    });
  }

  private injectLayoutSwitchers() {
    const galleries = Array.from(document.querySelectorAll<HTMLElement>('.cms-rich-gallery'));
    if (!galleries.length) return;

    // Find the main gallery container or the heading before the first gallery
    const firstGallery = galleries[0];
    const parent = firstGallery.parentElement;
    if (!parent) return;

    if (parent.querySelector('.cms-gallery-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'cms-gallery-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Diseño de la galería');

    toolbar.innerHTML = `
      <div class="cms-gallery-toolbar-inner">
        <span class="cms-gallery-toolbar-label">
          <svg class="w-4 h-4 text-ugr-green inline mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          Diseño de galería:
        </span>
        <div class="cms-gallery-toolbar-btns">
          <button type="button" class="cms-layout-btn is-active" data-layout="mosaic" title="Mosaico asimétrico estilo editorial y catálogo de arte">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h8v8H3zm10 0h8v4h-8zm0 6h8v12h-8zM3 13h8v8H3z"/>
            </svg>
            <span>Mosaico Editorial</span>
          </button>
          <button type="button" class="cms-layout-btn" data-layout="masonry" title="Muro dinámico respetando el formato original de cada fotografía">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h5v18H3zm7 0h5v10h-5zm0 12h5v6h-5zm7-12h4v14h-4zm0 16h4v2h-4z"/>
            </svg>
            <span>Muro Libre</span>
          </button>
          <button type="button" class="cms-layout-btn" data-layout="grid" title="Cuadrícula uniforme tradicional">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h5v5H3zm7 0h5v5h-5zm7 0h5v5h-5zM3 10h5v5H3zm7 0h5v5h-5zm7 0h5v5h-5zM3 17h5v5H3zm7 0h5v5h-5zm7 0h5v5h-5z"/>
            </svg>
            <span>Cuadrícula</span>
          </button>
        </div>
      </div>
    `;

    // Insert toolbar right before the first gallery or before its heading
    let insertBeforeEl: HTMLElement = firstGallery;
    let prev = firstGallery.previousElementSibling;
    while (prev) {
      if (prev.tagName === 'H2' && prev.textContent?.includes('Galerías')) {
        insertBeforeEl = (prev.nextElementSibling as HTMLElement) || firstGallery;
        break;
      }
      prev = prev.previousElementSibling;
    }

    parent.insertBefore(toolbar, insertBeforeEl);

    toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-layout]');
      if (!btn) return;
      const newLayout = btn.getAttribute('data-layout') as CreativeLayout;
      if (!newLayout || newLayout === this.activeLayout) return;

      this.activeLayout = newLayout;

      // Update button active state
      toolbar.querySelectorAll('.cms-layout-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      // Update all galleries
      galleries.forEach((gallery) => {
        gallery.setAttribute('data-creative-layout', newLayout);
      });
    });
  }

  private bindEvents() {
    if (!this.overlay) return;

    this.overlay.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]');
      if (!target) return;
      const action = target.getAttribute('data-action');

      if (action === 'close') {
        this.close();
      } else if (action === 'backdrop-close') {
        if ((e.target as HTMLElement).classList.contains('cms-lightbox-figure-wrap')) {
          this.close();
        }
      } else if (action === 'prev') {
        this.prev();
      } else if (action === 'next') {
        this.next();
      } else if (action === 'fullscreen') {
        this.toggleFullscreen();
      }
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.isOpen()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.prev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.next();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.toggleFullscreen();
      }
    });

    // Touch swipe gestures
    const stage = this.overlay.querySelector('.cms-lightbox-stage');
    if (stage) {
      stage.addEventListener('touchstart', (e: TouchEvent) => {
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
      }, { passive: true });

      stage.addEventListener('touchend', (e: TouchEvent) => {
        const deltaX = e.changedTouches[0].clientX - this.touchStartX;
        const deltaY = e.changedTouches[0].clientY - this.touchStartY;

        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) {
          if (deltaX > 0) {
            this.prev();
          } else {
            this.next();
          }
        } else if (deltaY > 80 && Math.abs(deltaX) < 60) {
          this.close();
        }
      }, { passive: true });
    }
  }

  private toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.overlay?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  private open(group: GalleryGroup, index: number) {
    if (!this.overlay || !group.items.length) return;
    this.currentGroup = group;
    this.currentIndex = Math.max(0, Math.min(index, group.items.length - 1));

    document.body.classList.add('cms-lightbox-active');
    this.overlay.style.display = 'flex';
    this.overlay.setAttribute('aria-hidden', 'false');

    const hasMultiple = group.items.length > 1;
    if (this.prevBtn) this.prevBtn.style.display = hasMultiple ? 'flex' : 'none';
    if (this.nextBtn) this.nextBtn.style.display = hasMultiple ? 'flex' : 'none';

    this.buildThumbnails();
    this.renderCurrent();

    const closeBtn = this.overlay.querySelector<HTMLElement>('.cms-lightbox-close');
    closeBtn?.focus();
  }

  private buildThumbnails() {
    if (!this.thumbnailsTrack || !this.currentGroup) return;
    this.thumbnailsTrack.innerHTML = '';

    if (this.currentGroup.items.length <= 1) {
      (this.thumbnailsTrack.parentElement as HTMLElement).style.display = 'none';
      return;
    }

    (this.thumbnailsTrack.parentElement as HTMLElement).style.display = 'block';

    this.currentGroup.items.forEach((item, idx) => {
      const thumbBtn = document.createElement('button');
      thumbBtn.type = 'button';
      thumbBtn.className = `cms-lightbox-thumb ${idx === this.currentIndex ? 'is-active' : ''}`;
      thumbBtn.setAttribute('aria-label', `Ir a foto ${idx + 1}`);
      thumbBtn.innerHTML = `<img src="${item.src}" alt="" loading="lazy" />`;

      thumbBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentIndex = idx;
        this.renderCurrent();
      });

      this.thumbnailsTrack?.appendChild(thumbBtn);
    });
  }

  private updateActiveThumbnail() {
    if (!this.thumbnailsTrack) return;
    const thumbs = Array.from(this.thumbnailsTrack.querySelectorAll<HTMLElement>('.cms-lightbox-thumb'));
    thumbs.forEach((thumb, idx) => {
      if (idx === this.currentIndex) {
        thumb.classList.add('is-active');
        thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        thumb.classList.remove('is-active');
      }
    });
  }

  private close() {
    if (!this.overlay) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    this.overlay.style.display = 'none';
    this.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cms-lightbox-active');

    if (this.imgElement) {
      this.imgElement.src = '';
    }

    if (this.triggerElement) {
      this.triggerElement.focus();
      this.triggerElement = null;
    }
  }

  private isOpen(): boolean {
    return this.overlay !== null && this.overlay.style.display !== 'none';
  }

  private prev() {
    if (!this.currentGroup || this.currentGroup.items.length <= 1) return;
    this.currentIndex = (this.currentIndex - 1 + this.currentGroup.items.length) % this.currentGroup.items.length;
    this.renderCurrent();
  }

  private next() {
    if (!this.currentGroup || this.currentGroup.items.length <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % this.currentGroup.items.length;
    this.renderCurrent();
  }

  private renderCurrent() {
    if (!this.currentGroup || !this.imgElement) return;
    const item = this.currentGroup.items[this.currentIndex];
    if (!item) return;

    this.imgElement.style.opacity = '0.3';
    this.imgElement.style.transform = 'scale(0.98)';
    this.imgElement.src = item.src;
    this.imgElement.alt = item.alt;

    this.imgElement.onload = () => {
      if (this.imgElement) {
        this.imgElement.style.opacity = '1';
        this.imgElement.style.transform = 'scale(1)';
      }
    };

    if (this.titleElement) {
      this.titleElement.textContent = this.currentGroup.title;
    }

    if (this.counterElement) {
      this.counterElement.textContent = `${this.currentIndex + 1} / ${this.currentGroup.items.length}`;
    }

    if (this.captionElement) {
      this.captionElement.textContent = item.caption;
      this.captionElement.style.display = item.caption ? 'block' : 'none';
    }

    this.updateActiveThumbnail();

    // Preload next and previous images
    const total = this.currentGroup.items.length;
    if (total > 1) {
      const nextIdx = (this.currentIndex + 1) % total;
      const prevIdx = (this.currentIndex - 1 + total) % total;
      const nextImg = new Image();
      nextImg.src = this.currentGroup.items[nextIdx].src;
      const prevImg = new Image();
      prevImg.src = this.currentGroup.items[prevIdx].src;
    }
  }
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new GalleryLightbox());
  } else {
    new GalleryLightbox();
  }
}
