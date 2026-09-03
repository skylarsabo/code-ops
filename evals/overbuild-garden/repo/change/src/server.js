import { readFileSync } from 'node:fs';
import { listUsers } from './users.js';
import { paginate, summarizeUsers } from './extract.js';

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));

export function start() {
  return { port: config.port, logLevel: config.logLevel, users: listUsers().length };
}

export function firstPage(size) {
  return paginate(listUsers(), 1, size);
}

export function overview() {
  return summarizeUsers(listUsers());
}
