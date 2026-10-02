const markReady = (image: HTMLImageElement) => {
  image.dataset.imageReady = 'true';
};

const observeImage = (image: HTMLImageElement) => {
  if (image.dataset.imageObserved) return;
  image.dataset.imageObserved = 'true';

  if (image.complete) {
    markReady(image);
    return;
  }

  image.addEventListener('load', () => markReady(image), { once: true });
  image.addEventListener('error', () => markReady(image), { once: true });
};

document.querySelectorAll<HTMLImageElement>('img').forEach(observeImage);

// El skeleton se activa únicamente después de instalar los observadores. Si este
// módulo no carga o la CSP lo bloquea, las imágenes conservan su estado visible.
document.documentElement.classList.add('image-loading-active');

new MutationObserver((records) => {
  records.forEach((record) =>
    record.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches('img')) observeImage(node as HTMLImageElement);
      node.querySelectorAll<HTMLImageElement>('img').forEach(observeImage);
    })
  );
}).observe(document.body, { childList: true, subtree: true });
