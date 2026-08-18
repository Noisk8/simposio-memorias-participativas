const buttons = document.querySelectorAll<HTMLElement>('.simposio-filter');
const cards = document.querySelectorAll<HTMLElement>('.memoria-card');
const noResults = document.getElementById('no-results');

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    buttons.forEach((candidate) => {
      candidate.classList.remove('bg-ugr-green', 'text-white');
      candidate.classList.add('bg-gray-100', 'text-ugr-green');
    });
    button.classList.remove('bg-gray-100', 'text-ugr-green');
    button.classList.add('bg-ugr-green', 'text-white');

    let visible = 0;
    cards.forEach((card) => {
      const matches = filter === 'all' || card.dataset.simposio === filter;
      card.classList.toggle('hidden', !matches);
      if (matches) visible += 1;
    });
    noResults?.classList.toggle('hidden', visible > 0);
  });
});
