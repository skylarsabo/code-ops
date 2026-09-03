export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
