export function fetchPos(id) {
  return new Map().get(id) ?? null;
}

export function getPos(id) {
  return fetchPos(id);
}
