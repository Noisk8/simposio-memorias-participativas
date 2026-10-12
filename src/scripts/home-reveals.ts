export function initHomeReveals(home: HTMLElement) {
  if (!('IntersectionObserver' in window)) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const elements = [...home.querySelectorAll<HTMLElement>('[data-home-reveal]')];
  const targets = new Map<Element, HTMLElement[]>();

  home.querySelectorAll<HTMLElement>('[data-reveal-kind="words"]').forEach((heading) => {
    let index = 0;
    // Se conservan los espacios y saltos de línea, así como el nombre accesible.
    [...heading.childNodes].forEach((node) => {
      if (node.nodeType !== 3) return;
      const fragment = document.createDocumentFragment();
      (node.textContent || '').split(/(\s+)/).forEach((word) => {
        if (!word.trim()) {
          fragment.append(document.createTextNode(word));
          return;
        }
        const mask = document.createElement('span');
        mask.className = 'home-word-mask';
        const inner = document.createElement('span');
        inner.className = 'home-word';
        inner.textContent = word;
        inner.style.setProperty('--word-delay', `${index++ * 55}ms`);
        mask.append(inner);
        fragment.append(mask);
      });
      heading.replaceChild(fragment, node);
    });
  });

  const show = (target: Element, immediate = false) => {
    targets.get(target)?.forEach((element) => {
      if (immediate) element.dataset.revealImmediate = 'true';
      element.dataset.homeReveal = 'visible';
    });
    observer.unobserve(target);
  };
  const observer = new window.IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) show(entry.target);
      });
    },
    { rootMargin: '0px 0px -48px 0px', threshold: 0.08 }
  );

  elements.forEach((element) => {
    // Los contenedores sin transformaciones ni máscaras activan cada objeto.
    // Así el cartel conserva su área de carga diferida aunque esté recortado.
    const target = element.closest('[data-reveal-anchor]') ?? element;
    const group = targets.get(target) ?? [];
    group.push(element);
    targets.set(target, group);
    element.dataset.homeReveal =
      reducedMotion.matches || target.getBoundingClientRect().top < window.innerHeight - 48
        ? 'visible'
        : 'pending';
  });
  targets.forEach((group, target) => {
    if (group.some((element) => element.dataset.homeReveal === 'pending')) observer.observe(target);
  });

  home.addEventListener('focusin', (event) => {
    if (!(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>('[data-home-reveal]');
    if (element) show(element.closest('[data-reveal-anchor]') ?? element, true);
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) targets.forEach((_, target) => show(target, true));
  });
}
