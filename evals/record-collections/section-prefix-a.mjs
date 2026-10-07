// Citation prefix and Markdown fence handling, part one. The body moved verbatim from the former single-file eval.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordId } from '../../scripts/record-lib.mjs';
import { COLLECTION, work, check, run, git, write, generated, adoptedFixture } from './harness.mjs';

export function runSection() {
  let result;
  const repo = adoptedFixture();

  const unknownCitationRepo = join(work, 'unknown-citation'); cpSync(repo, unknownCitationRepo, { recursive: true });
  const unknownCitationPath = generated(unknownCitationRepo, 'citations.json');
  const unknownCitations = JSON.parse(readFileSync(unknownCitationPath, 'utf8'));
  unknownCitations.entries.push({ ...unknownCitations.entries[0], recordId: 'REC-AAAAAAAAAAAAAAAAAAAAAAAAAA' });
  writeFileSync(unknownCitationPath, `${JSON.stringify(unknownCitations, null, 2)}\n`);
  result = run(['check', '--root', unknownCitationRepo, ...COLLECTION], unknownCitationRepo);
  check('valid citation-shaped entries for unknown records fail', result.status === 1
    && result.output.includes('citation references unknown record'), result.output);

  const unknownPrefixRepo = join(work, 'unknown-prefix'); cpSync(repo, unknownPrefixRepo, { recursive: true });
  write(unknownPrefixRepo, 'hub/unknown-prefix.md', '# Unknown record\n\n`REC-ZZZZZZZZ`\n');
  git(['add', 'hub/unknown-prefix.md'], unknownPrefixRepo);
  result = run(['check', '--root', unknownPrefixRepo, ...COLLECTION], unknownPrefixRepo);
  check('unknown record prefixes in vault prose fail', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const nestedPrefixRepo = join(work, 'nested-prefix'); cpSync(repo, nestedPrefixRepo, { recursive: true });
  write(nestedPrefixRepo, 'hub/nested-prefix.md', '# Nested record\n\n- outer bullet\n    - nested bullet references REC-ZZZZZZZZ\n');
  git(['add', 'hub/nested-prefix.md'], nestedPrefixRepo);
  result = run(['check', '--root', nestedPrefixRepo, ...COLLECTION], nestedPrefixRepo);
  check('unknown record prefixes in nested list prose fail', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const lazyPrefixRepo = join(work, 'lazy-prefix'); cpSync(repo, lazyPrefixRepo, { recursive: true });
  write(lazyPrefixRepo, 'hub/lazy-prefix.md', '# Lazy record\n\nParagraph\n    continuation references REC-XXXXXXXX\n');
  git(['add', 'hub/lazy-prefix.md'], lazyPrefixRepo);
  result = run(['check', '--root', lazyPrefixRepo, ...COLLECTION], lazyPrefixRepo);
  check('indented paragraph continuations remain visible to record-prefix checks', result.status === 1
    && result.output.includes('record prefix REC-XXXXXXXX is unresolved'), result.output);

  const quotedLazyPrefixRepo = join(work, 'quoted-lazy-prefix'); cpSync(repo, quotedLazyPrefixRepo, { recursive: true });
  write(quotedLazyPrefixRepo, 'hub/quoted-lazy-prefix.md', '# Quoted lazy record\n\n> Paragraph\n    continuation references REC-VVVVVVVV\n');
  git(['add', 'hub/quoted-lazy-prefix.md'], quotedLazyPrefixRepo);
  result = run(['check', '--root', quotedLazyPrefixRepo, ...COLLECTION], quotedLazyPrefixRepo);
  check('lazy blockquote continuations remain visible to record-prefix checks', result.status === 1
    && result.output.includes('record prefix REC-VVVVVVVV is unresolved'), result.output);

  const indentedPrefixRepo = join(work, 'indented-prefix'); cpSync(repo, indentedPrefixRepo, { recursive: true });
  write(indentedPrefixRepo, 'hub/indented-prefix.md', '# Indented record\n\n    REC-ASDFGHJK\n');
  git(['add', 'hub/indented-prefix.md'], indentedPrefixRepo);
  result = run(['check', '--root', indentedPrefixRepo, ...COLLECTION], indentedPrefixRepo);
  check('unambiguous top-level indented record examples do not create citation debt', result.status === 0, result.output);

  const fencedPrefixRepo = join(work, 'fenced-prefix-example'); cpSync(repo, fencedPrefixRepo, { recursive: true });
  write(fencedPrefixRepo, 'hub/fenced-prefix-example.md', `# Record examples

\`\`\`yaml
supersedes: ["REC-ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
\`\`\`

~~~yaml
supersedes: ["REC-ZYXWVUTSRQPONMLKJIHGFEDCBA"]
~~~

~~~~yaml
REC-ZZZZZZZZ
~~~
~~~~

> ~~~yaml
> supersedes: ["REC-QWERTYUIOPASDFGHJKLZXCVBNM"]
> ~~~
`);
  git(['add', 'hub/fenced-prefix-example.md'], fencedPrefixRepo);
  result = run(['check', '--root', fencedPrefixRepo, ...COLLECTION], fencedPrefixRepo);
  check('fenced record examples do not create citation debt', result.status === 0, result.output);

  const quotedFenceExitRepo = join(work, 'quoted-fence-exit'); cpSync(repo, quotedFenceExitRepo, { recursive: true });
  write(quotedFenceExitRepo, 'hub/quoted-fence-exit.md', `# Quoted fence exit

> \`\`\`yaml
> supersedes: []
Visible reference: REC-ZZZZZZZZ
> \`\`\`
`);
  git(['add', 'hub/quoted-fence-exit.md'], quotedFenceExitRepo);
  result = run(['check', '--root', quotedFenceExitRepo, ...COLLECTION], quotedFenceExitRepo);
  check('record-prefix scanning resumes when a blockquote container ends', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const nestedQuoteExitRepo = join(work, 'nested-quote-exit'); cpSync(repo, nestedQuoteExitRepo, { recursive: true });
  write(nestedQuoteExitRepo, 'hub/nested-quote-exit.md', `# Nested quote exit

> > \`\`\`yaml
> Visible reference: REC-XXXXXXXX
> > \`\`\`
`);
  git(['add', 'hub/nested-quote-exit.md'], nestedQuoteExitRepo);
  result = run(['check', '--root', nestedQuoteExitRepo, ...COLLECTION], nestedQuoteExitRepo);
  check('record-prefix scanning resumes at a parent blockquote depth', result.status === 1
    && result.output.includes('record prefix REC-XXXXXXXX is unresolved'), result.output);

  const quotedFenceEofRepo = join(work, 'quoted-fence-eof'); cpSync(repo, quotedFenceEofRepo, { recursive: true });
  write(quotedFenceEofRepo, 'hub/quoted-fence-eof.md', '# Quoted fence EOF\n\n> ```yaml\n> supersedes: []\n');
  git(['add', 'hub/quoted-fence-eof.md'], quotedFenceEofRepo);
  result = run(['check', '--root', quotedFenceEofRepo, ...COLLECTION], quotedFenceEofRepo);
  check('a blockquote container may close its fence at end of file', result.status === 0, result.output);

}
