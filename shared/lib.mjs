export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const data = {};
  const lines = yaml.split('\n');
  let currentKey = null;
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue;
    const arrayItem = line.match(/^\s*-\s+(.+)/);
    if (arrayItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(arrayItem[1].trim());
      continue;
    }
    const kv = line.match(/^(\w+):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '' || val === '""' || val === "''") {
        data[currentKey] = '';
      } else if (val === 'true') {
        data[currentKey] = true;
      } else if (val === 'false') {
        data[currentKey] = false;
      } else if (!isNaN(Number(val))) {
        data[currentKey] = Number(val);
      } else if (/^"(.*)"$/.test(val) || /^'(.*)'$/.test(val)) {
        data[currentKey] = val.slice(1, -1);
      } else {
        data[currentKey] = val;
      }
    }
  }
  return data;
}

export function isValidPublicImagePath(value) {
  return /^\/images\/[a-z0-9][a-z0-9_./-]*\.(?:avif|gif|jpe?g|png|webp)$/i.test(
    String(value ?? '').trim()
  );
}

export function createRateLimiter({ max = 20, windowMs = 60000 } = {}) {
  const buckets = new Map();

  function prune(now) {
    if (buckets.size < 10000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return function check(key, now = Date.now()) {
    prune(now);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    bucket.count += 1;
    if (bucket.count <= max) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  };
}
