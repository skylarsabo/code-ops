import { slugify } from './text.js';

const users = new Map();

export function fetchUser(id) {
  return users.get(id) ?? null;
}

export function listUsers() {
  return [...users.values()];
}

export function formatName(user) {
  return `${user.first} ${user.last}`;
}

export function userSlug(user) {
  return slugify(formatName(user));
}
