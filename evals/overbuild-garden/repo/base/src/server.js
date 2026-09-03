import { readFileSync } from 'node:fs';
import { listUsers } from './users.js';

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));

export function start() {
  return { port: config.port, users: listUsers().length };
}
