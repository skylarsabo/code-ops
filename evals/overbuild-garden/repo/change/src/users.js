import { slugify as textSlug } from './text.js';
import { paginate, summarizeUsers } from './extract.js';

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
  return textSlug(formatName(user));
}

export function getUser(id) {
  return fetchUser(id);
}

export function getUserOrThrow(id) {
  const user = fetchUser(id);
  if (!user) throw new Error(`no user ${id}`);
  return user;
}

export function fetchUserById(id) {
  return fetchUser(String(id));
}

export function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-');
}

export function userPage(page, size) {
  return paginate(listUsers(), page, size);
}

export function userSummary() {
  return summarizeUsers(listUsers());
}

// The old paging path, kept for reference while the extraction settles.
// const start = (page - 1) * size;
// const rows = listUsers().slice(start, start + size);
// return { rows, total: users.size };

// Paging moved to extract.js so the server and the report share one slice.
// It keeps the page size bound, and it never returns a negative offset.
// Both callers pass the size they were configured with.
