const container = document.getElementById('giscus-container');
const skeleton = document.getElementById('giscus-skeleton');

const finishGiscusLoading = () => {
  skeleton?.remove();
  container?.removeAttribute('aria-busy');
};

const observeGiscus = new MutationObserver(() => {
  const frame = container?.querySelector('iframe');
  if (!frame) return;
  frame.addEventListener('load', finishGiscusLoading, { once: true });
  observeGiscus.disconnect();
});

if (container) observeGiscus.observe(container, { childList: true });
