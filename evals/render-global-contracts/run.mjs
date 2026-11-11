#!/usr/bin/env node
// Regression eval for scripts/render-global-contracts.mjs. It copies the renderer into a scratch
// repo layout and runs it on small sources. It asserts per-host selection, stripped backstop and
// note lines, byte-stable output, a CRLF source, audience blocks and the lead file, every
// fail-closed source error, the leak guard, --check drift (missing, stale, unexpected), and the
// usage error.
//
//   node evals/render-global-contracts/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fails = [];
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) { fails.push(name); if (detail) console.log(detail); } };
const tmp = mkdtempSync(join(tmpdir(), 'render-global-'));

const repo = join(tmp, 'repo');
const dir = join(repo, 'global-contracts');
mkdirSync(join(repo, 'scripts'), { recursive: true });
mkdirSync(dir);
mkdirSync(join(repo, 'plugins', 'p', 'hooks'), { recursive: true });
mkdirSync(join(repo, 'plugins', 'code-ops-suite', 'hooks'), { recursive: true });
mkdirSync(join(repo, 'code-ops-docs', '50 Platform'), { recursive: true });
copyFileSync(join(REPO, 'scripts', 'render-global-contracts.mjs'), join(repo, 'scripts', 'render-global-contracts.mjs'));
writeFileSync(join(repo, 'plugins', 'p', 'hooks', 'guard.mjs'), '// stub\n');
writeFileSync(join(repo, 'code-ops-docs', '50 Platform', 'INFRASTRUCTURE.md'), '| `CODE_OPS_STUB_SWITCH` | `off` | the stub |\n');

const HOSTS = ['claude', 'codex', 'grok'];
const SOURCE = join(dir, 'AGENTS.source.md');
const out = (host) => join(dir, `AGENTS.${host}.md`);
const LEAD = join(repo, 'plugins', 'code-ops-suite', 'hooks', 'lead-doctrine.claude.md');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

function render(args = []) {
  const r = spawnSync(process.execPath, [join(repo, 'scripts', 'render-global-contracts.mjs'), ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
// Each case starts from a clean directory holding only the given source.
function withSource(text) {
  for (const f of readdirSync(dir)) rmSync(join(dir, f));
  rmSync(LEAD, { force: true });
  writeFileSync(SOURCE, text);
}

const GOOD = [
  '# Title', '',
  'Shared paragraph.', '',
  '<!-- host: claude,codex -->', '', 'Claude and Codex paragraph.', '', '<!-- /host -->', '',
  '<!-- host: grok -->', '', 'Grok paragraph.', '', '<!-- /host -->', '',
  '<!-- host: codex -->', '', 'Codex paragraph.', '', '<!-- /host -->', '',
  'Pointer line.',
  '<!-- backstop: plugins/p/hooks/guard.mjs switch=CODE_OPS_STUB_SWITCH -->', '',
  '<!-- note: stripped from every render -->', '',
  'Closing paragraph.', '',
].join('\n');

try {
  // Per-host selection, stripped directives, and byte-stable output.
  withSource(GOOD);
  let r = render();
  check('render exits 0', r.code === 0, r.out);
  const claude = read(out('claude')); const codex = read(out('codex')); const grok = read(out('grok'));
  check('claude render keeps shared and claude,codex text only',
    claude === '# Title\n\nShared paragraph.\n\nClaude and Codex paragraph.\n\nPointer line.\n\nClosing paragraph.\n', claude);
  check('codex render adds the codex block', codex === '# Title\n\nShared paragraph.\n\nClaude and Codex paragraph.\n\nCodex paragraph.\n\nPointer line.\n\nClosing paragraph.\n', codex);
  check('grok render keeps the grok block only', grok === '# Title\n\nShared paragraph.\n\nGrok paragraph.\n\nPointer line.\n\nClosing paragraph.\n', grok);
  check('no render carries a directive', HOSTS.every((h) => !/<!--|-->/.test(read(out(h)))));
  check('no render ends with a blank line or holds three newlines', HOSTS.every((h) => read(out(h)).endsWith('.\n') && !/\n{3}/.test(read(out(h)))));
  const first = HOSTS.map((h) => read(out(h)));
  render();
  check('a second render is byte-identical', HOSTS.every((h, i) => read(out(h)) === first[i]));
  check('--stats prints words per host', /claude\s+\d+ words/.test(render(['--stats']).out) && /grok\s+\d+ words/.test(render(['--stats']).out));
  check('--check exits 0 when current', render(['--check']).code === 0);

  // A CRLF source renders the same bytes.
  withSource(GOOD.replace(/\n/g, '\r\n'));
  render();
  check('a CRLF source renders the LF bytes', read(out('claude')) === claude && read(out('codex')) === codex && read(out('grok')) === grok);

  // --check drift: stale, missing, unexpected; a CRLF derived file is not drift.
  writeFileSync(out('grok'), `${grok}Edited by hand.\n`);
  r = render(['--check']);
  check('--check exits 1 on a stale file and names it', r.code === 1 && /stale generated file: global-contracts\/AGENTS\.grok\.md/.test(r.out), r.out);
  render();
  rmSync(out('codex'));
  r = render(['--check']);
  check('--check exits 1 on a missing file', r.code === 1 && /missing generated file: global-contracts\/AGENTS\.codex\.md/.test(r.out), r.out);
  render();
  writeFileSync(out('claude'), claude.replace(/\n/g, '\r\n'));
  check('--check ignores line-ending differences', render(['--check']).code === 0);
  writeFileSync(join(dir, 'AGENTS.md'), 'dead file\n');
  r = render(['--check']);
  check('--check exits 1 on any other .md file', r.code === 1 && /unexpected file: global-contracts\/AGENTS\.md/.test(r.out), r.out);
  check('the write mode refuses it too', render().code === 1);

  // Audience blocks: the claude render drops them, the lead file holds them under their section
  // headings, and the other renders keep them inline with a split paragraph rejoined.
  withSource([
    '# Title', '', '## One', '', 'Core one.', '',
    '<!-- audience: lead -->', '', 'Lead one.', '', '<!-- host: codex -->', '', 'Codex lead.', '', '<!-- /host -->', '', '<!-- /audience -->', '',
    '## Two', '', 'First half ends here.', '<!-- audience: lead -->', 'Second half follows.', '<!-- /audience -->', '', 'Core two.', '',
  ].join('\n'));
  r = render();
  check('an audience source renders', r.code === 0, r.out);
  check('the claude render drops audience text', read(out('claude')) === '# Title\n\n## One\n\nCore one.\n\n## Two\n\nFirst half ends here.\n\nCore two.\n', read(out('claude')));
  const lead = read(LEAD) ?? '';
  check('the lead file holds audience text under its section headings',
    lead.startsWith('# Lead doctrine\n\n') && lead.endsWith('\n\n## One\n\nLead one.\n\n## Two\n\nSecond half follows.\n') && !/<!--|-->|Codex lead/.test(lead), lead);
  check('a codex render keeps audience text inline and rejoins the split paragraph',
    read(out('codex')) === '# Title\n\n## One\n\nCore one.\n\nLead one.\n\nCodex lead.\n\n## Two\n\nFirst half ends here. Second half follows.\n\nCore two.\n', read(out('codex')));
  check('a grok render keeps audience text inline', read(out('grok')) === '# Title\n\n## One\n\nCore one.\n\nLead one.\n\n## Two\n\nFirst half ends here. Second half follows.\n\nCore two.\n', read(out('grok')));
  check('--check exits 0 with a current lead file', render(['--check']).code === 0);
  writeFileSync(LEAD, `${lead}Edited by hand.\n`);
  r = render(['--check']);
  check('--check exits 1 on a stale lead file', r.code === 1 && /stale generated file: plugins\/code-ops-suite\/hooks\/lead-doctrine\.claude\.md/.test(r.out), r.out);
  rmSync(LEAD);
  r = render(['--check']);
  check('--check exits 1 on a missing lead file', r.code === 1 && /missing generated file: plugins\/code-ops-suite\/hooks\/lead-doctrine\.claude\.md/.test(r.out), r.out);
  render();
  check('the write mode restores the lead file', read(LEAD) === lead);
  writeFileSync(join(dir, 'lead-doctrine.claude.md'), 'misplaced\n');
  r = render(['--check']);
  check('--check still exits 1 on an unexpected .md in global-contracts/', r.code === 1 && /unexpected file: global-contracts\/lead-doctrine\.claude\.md/.test(r.out), r.out);

  // Fail-closed source errors. Each exits 1, names the problem, and writes no render.
  const bad = (name, source, pattern) => {
    withSource(source);
    const res = render();
    check(name, res.code === 1 && pattern.test(res.out) && HOSTS.every((h) => !existsSync(out(h))) && !existsSync(LEAD), res.out);
  };
  bad('an unclosed host block fails', 'Text.\n\n<!-- host: claude -->\n\nOpen.\n', /never closed/);
  bad('a nested host block fails', '<!-- host: claude -->\n\n<!-- host: codex -->\n\nX.\n\n<!-- /host -->\n\n<!-- /host -->\n', /nested host block/);
  bad('a stray /host fails', 'Text.\n\n<!-- /host -->\n', /stray \/host/);
  bad('an unknown host name fails', '<!-- host: claude,gemini -->\n\nX.\n\n<!-- /host -->\n', /host list must name only/);
  bad('an empty host list fails', '<!-- host: -->\n\nX.\n\n<!-- /host -->\n', /host list must name only/);
  bad('a missing backstop path fails', 'Text.\n<!-- backstop: plugins/p/hooks/missing.mjs -->\n', /backstop path does not exist/);
  bad('an unknown switch name fails', 'Text.\n<!-- backstop: plugins/p/hooks/guard.mjs switch=CODE_OPS_NO_SUCH -->\n', /switch CODE_OPS_NO_SUCH is not in INFRASTRUCTURE\.md/);
  bad('text before a directive on its line fails', 'Text <!-- note: x -->\n', /must sit alone on its line/);
  bad('text after a directive on its line fails', '<!-- host: claude --> trailing\n\nX.\n\n<!-- /host -->\n', /must sit alone on its line/);
  bad('an unknown directive fails', '<!-- shout: hello -->\n', /unknown directive/);
  bad('an unclosed audience block fails', 'Text.\n\n<!-- audience: lead -->\n\nOpen.\n', /audience block opened at .* is never closed/);
  bad('a nested audience block fails', '<!-- audience: lead -->\n\n<!-- audience: lead -->\n\nX.\n\n<!-- /audience -->\n\n<!-- /audience -->\n', /nested audience block/);
  bad('a stray /audience fails', 'Text.\n\n<!-- /audience -->\n', /stray \/audience/);
  bad('an unknown audience fails', '<!-- audience: worker -->\n\nX.\n\n<!-- /audience -->\n', /unknown audience: worker/);
  bad('an audience marker inside a host block fails', '<!-- host: claude -->\n\n<!-- audience: lead -->\n\nX.\n\n<!-- /audience -->\n\n<!-- /host -->\n', /audience marker cannot sit inside a host block/);
  bad('a heading inside an audience block fails', '<!-- audience: lead -->\n\n## Heading\n\nX.\n\n<!-- /audience -->\n', /audience block cannot hold a heading/);
  bad('a mid-sentence audience split fails', 'Text that runs\n<!-- audience: lead -->\non here.\n<!-- /audience -->\n', /must follow a line that ends a sentence/);

  // Leak guard: a term reserved for another host fails the render.
  withSource('Shared paragraph.\n\nGrok-only prose leaked here.\n');
  r = render();
  check('the leak guard trips on a reserved term in the claude render', r.code === 1 && /the claude render contains the reserved term "Grok"/.test(r.out) && !existsSync(out('claude')), r.out);
  withSource('Shared paragraph.\n\n<!-- host: codex -->\n\nAstra text.\n\n<!-- /host -->\n\n<!-- host: claude,grok -->\n\nFable text.\n\n<!-- /host -->\n');
  r = render();
  check('the leak guard trips on Fable in the grok render', r.code === 1 && /the grok render contains the reserved term "Fable"/.test(r.out), r.out);
  withSource('Shared paragraph.\n\n<!-- audience: lead -->\n\nAstra lead text.\n\n<!-- /audience -->\n');
  r = render();
  check('the leak guard holds the lead file to the claude terms', r.code === 1 && /the lead file contains the reserved term "Astra"/.test(r.out) && !existsSync(LEAD), r.out);

  // Usage.
  check('an unknown flag is exit 2', render(['--write']).code === 2);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} assertion(s) failed` : '\nall render-global-contracts assertions pass');
process.exit(fails.length ? 1 : 0);
