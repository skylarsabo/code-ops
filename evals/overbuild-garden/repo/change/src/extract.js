// Paging and summary over a user list, shared by the server and the users module.
// Both callers passed the same slice arithmetic before this module existed.

const MAX_PAGE = 200;

function clampSize(size) {
  if (!Number.isFinite(size) || size < 1) return 1;
  return Math.min(Math.floor(size), MAX_PAGE);
}

function clampPage(page) {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

export function paginate(rows, page, size) {
  const bounded = clampSize(size);
  const current = clampPage(page);
  const start = (current - 1) * bounded;
  const slice = rows.slice(start, start + bounded);
  return {
    rows: slice,
    page: current,
    size: bounded,
    total: rows.length,
    pages: Math.max(1, Math.ceil(rows.length / bounded)),
  };
}

function countBy(rows, pick) {
  const counts = new Map();
  for (const row of rows) {
    const key = pick(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function summarizeUsers(rows) {
  const byDomain = countBy(rows, (u) => String(u.email ?? '').split('@')[1] ?? 'none');
  const active = rows.filter((u) => u.active).length;
  return {
    total: rows.length,
    active,
    inactive: rows.length - active,
    domains: Object.fromEntries(byDomain),
  };
}
