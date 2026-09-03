export const MAX_PAGE = 10;

export function paginate(rows, page, size) {
  const start = (page - 1) * size;
  return rows.slice(start, start + Math.min(size, MAX_PAGE));
}
