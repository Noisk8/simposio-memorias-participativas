export function eventToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function groupEvents<T extends { data: { date: string; title: string } }>(
  events: T[],
  today = eventToday()
): { upcoming: T[]; past: T[] } {
  const byTitle = (a: T, b: T) => a.data.title.localeCompare(b.data.title, 'es');
  return {
    upcoming: events
      .filter((event) => event.data.date >= today)
      .sort((a, b) => a.data.date.localeCompare(b.data.date) || byTitle(a, b)),
    past: events
      .filter((event) => event.data.date < today)
      .sort((a, b) => b.data.date.localeCompare(a.data.date) || byTitle(a, b)),
  };
}

export function formatEventDate(date: string): string {
  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
}
