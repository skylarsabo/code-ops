#!/usr/bin/env node
// Prints the brief template for one suite agent: each field on the `Brief requires:` line of
// the agent's `## Contract` section, as one `Label:` line in contract order, ready to fill.
//
//   node scripts/brief-template.mjs <plugin>:<agent>     (also `co brief <plugin>:<agent>`)
//
// WHY: the dispatch guard (hooks/dispatch-guard.mjs) denies a dispatch whose brief lacks one of
// those fields, and its denial lists only the missing labels in this same form. This prints the
// whole set before the first dispatch. The fields are read as the guard's requiredFields reads
// them, and the agent file resolves through hooks/agent-file.mjs, the resolver both hooks
// share: beside this script in a code-ops-suite copy, or under plugins/code-ops-suite/ in the
// repository checkout. A plugin copy without that resolver reports it, never guesses.
//
// Exit: 0 with the template on stdout; 2 when the type is not `<plugin>:<agent>` in a suite
// plugin, the definition is missing, or its Contract has no `Brief requires:` line.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOLVERS = [
  join(HERE, '..', 'hooks', 'agent-file.mjs'),
  join(HERE, '..', 'plugins', 'code-ops-suite', 'hooks', 'agent-file.mjs'),
];
const USAGE = 'usage: brief-template.mjs <plugin>:<agent>   (for example code-ops-suite:implementer)';

function fail(message) {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] === '--help' || args[0] === '-h') {
  console.log(USAGE);
  process.exit(0);
}
if (args.length !== 1) fail(USAGE);
const type = args[0].trim();

const resolver = RESOLVERS.find((path) => existsSync(path));
if (!resolver) fail('brief-template: hooks/agent-file.mjs is not bundled beside this script');
const { agentFile } = await import(pathToFileURL(resolver).href);

const path = agentFile(type);
if (!path) fail(`brief-template: no agent definition for ${type}; name a suite agent as <plugin>:<agent>`);
const text = readFileSync(path, 'utf8');
// The same two patterns as requiredFields in hooks/dispatch-guard.mjs.
const section = /^## Contract[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
const line = /^Brief requires:[ \t]*(.+)$/m.exec(section)?.[1] ?? '';
const fields = line.split(',').map((field) => field.trim()).filter(Boolean);
if (!fields.length) fail(`brief-template: ${type} declares no Brief requires line in its Contract`);

console.log(fields.map((field) => `${field}:`).join('\n'));
