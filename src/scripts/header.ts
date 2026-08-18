const menuButton = document.getElementById('mobile-menu-btn');
const mobileNavigation =
  menuButton?.closest('nav')?.querySelector('.md\\:hidden.flex-col') ||
  document.querySelector('nav .md\\:hidden');

menuButton?.addEventListener('click', () => {
  mobileNavigation?.classList.toggle('hidden');
});

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[contenteditable="true"]')
  );
}

document.addEventListener('keydown', (event) => {
  if (
    event.ctrlKey &&
    event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'y' &&
    !isTypingTarget(event.target)
  ) {
    event.preventDefault();
    window.location.assign('/admin/login');
  }
});
