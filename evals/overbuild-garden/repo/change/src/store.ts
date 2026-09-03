// A key-value store behind one interface.
// The memory store is the only implementor today.
// A file-backed store was planned and never written.

export interface Store {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export class MemoryStore implements Store {
  private data = new Map<string, string>();
  get(key: string) { return this.data.get(key); }
  set(key: string, value: string) { this.data.set(key, value); }
}
