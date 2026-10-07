export function fetchThing(id) {
  return new Map().get(id) ?? null;
}

export function describeThing(id) {
  return `thing ${fetchThing(id)}`;
}
