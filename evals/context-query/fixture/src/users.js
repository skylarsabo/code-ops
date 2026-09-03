import { slugify, truncate as cut } from './text.js';
import { paginate } from './lib/page.js';

export function fetchUser(id) {
  return id ? { id, name: `user ${id}` } : null;
}

export function getUser(id) {
  const user = fetchUser(id);
  return user ? cut(slugify(user.name), 10) : null;
}

export function page(rows) {
  return paginate(rows, 1, 10);
}
