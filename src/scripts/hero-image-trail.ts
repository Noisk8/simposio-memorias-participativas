/* global Animation, PointerEvent */

// Una cantidad fija de tarjetas evita acumular nodos al recorrer el hero.
const hero = document.querySelector<HTMLElement>('[data-home-hero]');
const layer = hero?.querySelector<HTMLElement>('[data-hero-trail]');

if (hero && layer) {
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sources: string[] = [...new Set<string>(JSON.parse(layer.dataset.trailImages || '[]'))];
  const cards: { element: HTMLDivElement; animation?: Animation }[] = [];
  const cache = new Map<string, { image: HTMLImageElement; ready: boolean; failed: boolean }>();
  let remaining: string[] = [];
  let lastSource = '';

  const reshuffle = () => {
    remaining = sources.filter((source) => !cache.get(source)?.failed);
    for (let index = remaining.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [remaining[index], remaining[swap]] = [remaining[swap], remaining[index]];
    }
    // Evita repetir la última foto al empezar una nueva vuelta.
    if (remaining.length > 1 && remaining[0] === lastSource) {
      [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
    }
  };
  const allowed = () => finePointer.matches && !reducedMotion.matches && !document.hidden;
  let initialized = false;
  let inside = false;
  let firstImage = false;
  let frame = 0;
  let previousTime = 0;
  let lastSpawnTime = -Infinity;
  let nextCard = 0;
  let sequence = 0;
  let bounds = hero.getBoundingClientRect();
  let target = { x: 0, y: 0 };
  let smooth = { x: 0, y: 0 };
  let lastSpawn = { x: 0, y: 0 };

  const wake = () => {
    if (!frame && inside && allowed()) frame = window.requestAnimationFrame(render);
  };

  const prepareImages = () => {
    if (initialized) return;
    initialized = true;
    for (let index = 0; index < Math.min(8, sources.length); index++) {
      const element = document.createElement('div');
      element.className = 'home-hero-trail-card';
      layer.append(element);
      cards.push({ element });
    }
    reshuffle();
    preloadNext();
  };

  const preloadNext = () => {
    if (!remaining.length) reshuffle();
    // Descarga progresiva: prepara las próximas cuatro, no todo el banco al entrar.
    remaining.slice(0, 4).forEach((source) => {
      if (cache.has(source)) return;
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.src = source;
      const entry = { image, ready: false, failed: false };
      cache.set(source, entry);
      void image
        .decode()
        .then(() => {
          image.dataset.imageReady = 'true';
          entry.ready = true;
          wake();
        })
        .catch(() => {
          entry.failed = true;
          wake();
        });
    });
  };

  const spawn = (time: number) => {
    if (!cards.length) return false;
    // Un archivo inaccesible no bloquea las fotos siguientes.
    while (remaining.length && cache.get(remaining[0])?.failed) remaining.shift();
    preloadNext();
    const source = remaining[0];
    const entry = cache.get(source);
    if (!entry?.ready) return false;
    const card = cards[nextCard++ % cards.length];
    remaining.shift();
    lastSource = source;
    card.animation?.cancel();
    card.element.replaceChildren(entry.image);
    preloadNext();
    const dx = Math.max(-60, Math.min(60, smooth.x - lastSpawn.x));
    const dy = Math.max(-60, Math.min(60, smooth.y - lastSpawn.y));
    const rotation = [-7, 5, -3, 8, -5, 3, -8, 6][sequence++ % 8];
    const transform = (x: number, y: number, angle: number, scale: number) =>
      `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) rotate(${angle}deg) scale(${scale})`;
    card.animation?.cancel();
    card.element.style.left = `${smooth.x}px`;
    card.element.style.top = `${smooth.y}px`;
    // La tarjeta nueva queda sobre las anteriores dentro de su propia capa.
    layer.append(card.element);
    card.animation = card.element.animate(
      [
        {
          opacity: 0,
          transform: transform(-dx * 0.3, -dy * 0.3, rotation - 4, 0.65),
          offset: 0,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        },
        { opacity: 1, transform: transform(0, 0, rotation, 1), offset: 0.2 },
        {
          opacity: 1,
          transform: transform(dx * 0.12, dy * 0.12, rotation + 1, 1),
          offset: 0.55,
          easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
        },
        {
          opacity: 0,
          transform: transform(dx * 0.4, dy * 0.4 + 14, rotation + 3, 0.88),
          offset: 1,
        },
      ],
      { duration: 1100, easing: 'linear' }
    );
    lastSpawn = { ...smooth };
    lastSpawnTime = time;
    firstImage = false;
    return true;
  };

  function render(time: number) {
    frame = 0;
    if (!inside || !allowed()) return;
    const elapsed = previousTime ? Math.min(50, time - previousTime) : 16;
    previousTime = time;
    const easing = 1 - Math.exp(-elapsed / 55);
    smooth.x += (target.x - smooth.x) * easing;
    smooth.y += (target.y - smooth.y) * easing;
    const distance = Math.hypot(smooth.x - lastSpawn.x, smooth.y - lastSpawn.y);
    if ((firstImage || distance >= 64) && time - lastSpawnTime >= 65) spawn(time);
    // Al detener el mouse termina la interpolación y cesan los cuadros de JS.
    if (Math.hypot(target.x - smooth.x, target.y - smooth.y) > 0.5) wake();
  }

  const clear = () => {
    inside = false;
    window.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    cards.forEach((card) => card.animation?.cancel());
  };

  hero.addEventListener(
    'pointermove',
    (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !allowed()) return;
      if (!inside) {
        bounds = hero.getBoundingClientRect();
        smooth = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        lastSpawn = { ...smooth };
        previousTime = 0;
        lastSpawnTime = -Infinity;
        firstImage = true;
      }
      target = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      inside = true;
      prepareImages();
      wake();
    },
    { passive: true }
  );

  hero.addEventListener('pointerleave', () => {
    // Las tarjetas ya emitidas completan su salida al abandonar el hero.
    inside = false;
    window.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  });
  window.addEventListener('scroll', clear, { passive: true });
  window.addEventListener('resize', clear, { passive: true });
  document.addEventListener('visibilitychange', clear);
  finePointer.addEventListener('change', clear);
  reducedMotion.addEventListener('change', clear);
}
