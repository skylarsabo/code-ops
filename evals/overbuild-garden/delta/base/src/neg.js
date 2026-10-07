export function fetchThing(id) {
  return new Map().get(id) ?? null;
}

export function getThing(id) {
  return fetchThing(id);
}

export function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

export function describeThing(id) {
  return `thing ${getThing(id)}`;
}
