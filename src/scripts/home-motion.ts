/* global SVGSVGElement, SVGPathElement, SVGCircleElement, HTMLVideoElement */
import { initHomeReveals } from './home-reveals';
const home = document.querySelector<HTMLElement>('[data-home]');

if (home) {
  const hero = home.querySelector<HTMLElement>('[data-home-hero]')!;
  const stage = home.querySelector<HTMLElement>('[data-video-stage]')!;
  const frame = home.querySelector<HTMLElement>('[data-video-frame]')!;
  const vector = home.querySelector<SVGSVGElement>('[data-home-vector]')!;
  const vectorSections = [...home.querySelectorAll<HTMLElement>('[data-vector-section]')];
  const surfaces = [...home.querySelectorAll<HTMLElement>('[data-home-surface]')];
  let surfacePositions: { element: HTMLElement; top: number }[] = [];
  const path = home.querySelector<SVGPathElement>('[data-vector-path]')!;
  const tip = home.querySelector<SVGCircleElement>('[data-vector-tip]')!;
  const heroVideo = home.querySelector<HTMLVideoElement>('[data-hero-video]')!;
  const reelVideo = home.querySelector<HTMLVideoElement>('[data-reel-video]')!;
  const heroToggle = home.querySelector<HTMLButtonElement>('[data-hero-toggle]')!;
  const header = document.querySelector<HTMLElement>('body > header');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 767px)');
  let pathLength = 0;
  let pathSamples: { y: number; length: number }[] = [];
  let animationId = 0;
  let currentProgress = -1;
  let heroVisible = false;
  let reelVisible = false;
  let heroPausedByUser = false;
  let reelTouchedByUser = false;
  let reelPreviewStarted = false;
  let heroTop = 0;
  let heroHeight = 1;
  let homeTop = 0;
  let stageTop = 0;

  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const ease = (value: number) => value * value * (3 - 2 * value);

  function measureVector() {
    const bounds = home!.getBoundingClientRect();
    homeTop = bounds.top + window.scrollY;
    const left = mobile.matches ? 0.025 : 0.075;
    const right = 1 - left;
    // Cada tramo se adapta a la altura real de su sección, incluida la agenda.
    const anchors: Record<string, [number, number][]> = {
      intro: [
        [0.15, 0.08],
        [right, 0.94],
      ],
      video: [
        [right, 0.12],
        [left, 0.76],
      ],
      agenda: [
        [right, 0.2],
        [right, 0.78],
        [left, 0.97],
      ],
      explore: [
        [left, 0.08],
        [right, 0.56],
        [left, 0.96],
      ],
      instagram: [
        [right, 0.26],
        [left, 0.94],
      ],
    };
    const points = vectorSections.flatMap((section) => {
      const sectionBounds = section.getBoundingClientRect();
      const top = sectionBounds.top - bounds.top;
      return (anchors[section.dataset.vectorSection ?? ''] ?? []).map(([x, y]) => ({
        x: x * bounds.width,
        y: top + y * sectionBounds.height,
      }));
    });
    if (!points.length) return;
    let shape = `M${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const point = points[index];
      const bend = (point.y - previous.y) * 0.5;
      shape += ` C${previous.x} ${previous.y + bend} ${point.x} ${point.y - bend} ${point.x} ${point.y}`;
    }
    vector.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    path.setAttribute('d', shape);
    pathLength = path.getTotalLength();
    path.setAttribute('stroke-dasharray', String(pathLength));
    tip.setAttribute('r', mobile.matches ? '5' : '9');
    // La altura aumenta en todo el recorrido. Este mapa mantiene el extremo
    // cerca de la parte inferior de la pantalla incluso en las curvas largas.
    pathSamples = Array.from({ length: 257 }, (_, index) => {
      const length = (pathLength * index) / 256;
      return { y: path.getPointAtLength(length).y, length };
    });
    drawVector(
      reducedMotion.matches
        ? 1
        : vectorProgressAt(window.scrollY + window.innerHeight * 0.82 - homeTop)
    );
  }

  function vectorProgressAt(y: number) {
    if (!pathSamples.length || y <= pathSamples[0].y) return 0;
    if (y >= pathSamples[pathSamples.length - 1].y) return 1;
    let low = 0;
    let high = pathSamples.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (pathSamples[middle].y <= y) low = middle;
      else high = middle;
    }
    const start = pathSamples[low];
    const end = pathSamples[high];
    const ratio = clamp((y - start.y) / (end.y - start.y));
    return (start.length + (end.length - start.length) * ratio) / pathLength;
  }

  function playPreview(video: HTMLVideoElement) {
    void video.play().catch(() => {
      // El poster y los controles siguen disponibles si no se permite autoplay.
    });
  }

  function syncPlayback() {
    if (heroVisible && !document.hidden && !reducedMotion.matches && !heroPausedByUser) {
      playPreview(heroVideo);
    } else {
      heroVideo.pause();
    }
    if (!reelVisible || document.hidden) {
      reelVideo.pause();
    } else if (!reducedMotion.matches && !reelTouchedByUser && !reelPreviewStarted) {
      reelPreviewStarted = true;
      playPreview(reelVideo);
    }
  }

  function drawVector(progress: number) {
    path.setAttribute('stroke-dashoffset', String(pathLength * (1 - progress)));
    const point = path.getPointAtLength(pathLength * progress);
    tip.setAttribute('cx', String(point.x));
    tip.setAttribute('cy', String(point.y));
    tip.setAttribute('opacity', progress > 0 ? '1' : '0');
  }

  function render() {
    animationId = 0;
    if (reducedMotion.matches || document.hidden) return;
    const viewport = window.innerHeight;
    const scroll = window.scrollY;
    surfacePositions.forEach(({ element, top }) => {
      const entry = ease(clamp((scroll + viewport - top) / (viewport * 0.65)));
      element.style.setProperty(
        '--section-radius',
        `${(1 - entry) * (mobile.matches ? 28 : 64)}px`
      );
      element.style.setProperty('--section-edge-shift', `${(1 - entry) * 64}px`);
    });
    const heroProgress = clamp((scroll - heroTop) / heroHeight);
    const vectorProgress = vectorProgressAt(scroll + viewport * 0.82 - homeTop);
    const targetProgress = clamp((scroll + viewport * 0.75 - stageTop) / (viewport * 0.8));
    if (currentProgress < 0) currentProgress = targetProgress;
    // Una interpolación corta suaviza la respuesta, sin alterar el scroll nativo.
    currentProgress += (targetProgress - currentProgress) * 0.18;
    if (Math.abs(targetProgress - currentProgress) < 0.001) currentProgress = targetProgress;
    const progress = ease(currentProgress);
    const amplitude = mobile.matches ? 0.12 : 0.46;
    home!.style.setProperty('--hero-shift', `${heroProgress * heroHeight * 0.16}px`);
    home!.style.setProperty('--hero-copy-shift', `${heroProgress * 100}px`);
    home!.style.setProperty('--hero-opacity', String(1 - heroProgress * 0.7));
    frame.style.setProperty('--video-scale', String(1 - amplitude * (1 - progress)));
    frame.style.setProperty('--video-rotate', `${-4 * (1 - progress)}deg`);
    frame.style.setProperty('--video-tilt', `${8 * (1 - progress)}deg`);
    frame.style.setProperty('--video-lift', `${48 * (1 - progress)}px`);
    frame.style.setProperty('--video-radius', `${16 + 40 * (1 - progress)}px`);
    frame.style.setProperty('--marker-rotate', `${180 * progress}deg`);
    drawVector(vectorProgress);
    if (currentProgress !== targetProgress) schedule();
  }

  function schedule() {
    if (!animationId && !reducedMotion.matches && !document.hidden) {
      animationId = window.requestAnimationFrame(render);
    }
  }

  function measure() {
    home!.style.setProperty(
      '--home-header-height',
      `${header?.getBoundingClientRect().height ?? 0}px`
    );
    heroTop = hero.getBoundingClientRect().top + window.scrollY;
    heroHeight = hero.offsetHeight;
    stageTop = stage.getBoundingClientRect().top + window.scrollY;
    surfacePositions = surfaces.map((element) => ({
      element,
      top: element.getBoundingClientRect().top + window.scrollY,
    }));
    measureVector();
    schedule();
  }

  function syncMotion() {
    home!.dataset.motion = reducedMotion.matches ? 'off' : 'on';
    currentProgress = -1;
    if (reducedMotion.matches) {
      window.cancelAnimationFrame(animationId);
      animationId = 0;
      home!.querySelectorAll<HTMLElement>('[data-home-reveal]').forEach((element) => {
        element.dataset.homeReveal = 'visible';
      });
      reelVideo.pause();
    }
    measure();
    syncPlayback();
  }

  heroToggle.hidden = false;
  heroToggle.addEventListener('click', () => {
    heroPausedByUser = !heroVideo.paused;
    if (heroVideo.paused) playPreview(heroVideo);
    else heroVideo.pause();
  });
  const updateHeroToggle = () => {
    heroToggle.textContent = heroVideo.paused ? 'Reproducir fondo' : 'Pausar fondo';
  };
  heroVideo.addEventListener('play', updateHeroToggle);
  heroVideo.addEventListener('pause', updateHeroToggle);
  updateHeroToggle();
  for (const event of ['pointerdown', 'keydown']) {
    reelVideo.addEventListener(event, () => {
      reelTouchedByUser = true;
    });
  }

  if ('IntersectionObserver' in window) {
    const videoObserver = new window.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === hero) heroVisible = entry.isIntersecting;
          else reelVisible = entry.isIntersecting;
        }
        syncPlayback();
      },
      { threshold: 0.15 }
    );
    videoObserver.observe(hero);
    videoObserver.observe(reelVideo);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('pageshow', measure);
  document.addEventListener('visibilitychange', () => {
    syncPlayback();
    schedule();
  });
  reducedMotion.addEventListener('change', syncMotion);
  mobile.addEventListener('change', measure);
  if ('ResizeObserver' in window) {
    const layoutObserver = new window.ResizeObserver(measure);
    layoutObserver.observe(home);
    if (header) layoutObserver.observe(header);
  }
  void document.fonts.ready.then(measure);
  initHomeReveals(home);
  syncMotion();
}
