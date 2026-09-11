const line = (className = '') =>
  `<span class="cms-skeleton cms-skeleton-line ${className}"></span>`;

export function cardSkeletons(count = 6) {
  return Array.from(
    { length: count },
    () => `<article class="cms-skeleton-card" aria-hidden="true">
      <span class="cms-skeleton cms-skeleton-media"></span>
      <span class="cms-skeleton-card-copy">${line('cms-skeleton-line-long')}${line('cms-skeleton-line-medium')}${line('cms-skeleton-line-short')}</span>
    </article>`
  ).join('');
}

export function rowSkeletons(count = 5) {
  return Array.from(
    { length: count },
    () => `<tr class="cms-skeleton-row" aria-hidden="true">
      <td>${line('cms-skeleton-line-long')}</td><td>${line('cms-skeleton-line-short')}</td><td>${line('cms-skeleton-line-medium')}</td><td>${line('cms-skeleton-line-medium')}</td>
    </tr>`
  ).join('');
}

export function setSkeleton(node: HTMLElement | null, html: string) {
  if (!node) return;
  node.setAttribute('aria-busy', 'true');
  node.innerHTML = html;
}

export function clearSkeleton(node: HTMLElement | null) {
  node?.removeAttribute('aria-busy');
}
