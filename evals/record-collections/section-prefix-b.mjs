// Citation prefix and Markdown fence handling, part two. The body moved verbatim from the former single-file eval.
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTION, work, check, run, git, write, adoptedFixture } from './harness.mjs';

export function runSection() {
  let result;
  const repo = adoptedFixture();

  const listFenceExitRepo = join(work, 'list-fence-exit'); cpSync(repo, listFenceExitRepo, { recursive: true });
  write(listFenceExitRepo, 'hub/list-fence-exit.md', '# List fence exit\n\n- example\n  ```yaml\n  supersedes: []\n\nVisible reference: REC-VVVVVVVV\n');
  git(['add', 'hub/list-fence-exit.md'], listFenceExitRepo);
  result = run(['check', '--root', listFenceExitRepo, ...COLLECTION], listFenceExitRepo);
  check('record-prefix scanning resumes when a list container ends', result.status === 1
    && result.output.includes('record prefix REC-VVVVVVVV is unresolved')
    && !result.output.includes('unterminated Markdown fence'), result.output);

  const listFenceEofRepo = join(work, 'list-fence-eof'); cpSync(repo, listFenceEofRepo, { recursive: true });
  write(listFenceEofRepo, 'hub/list-fence-eof.md', '# List fence EOF\n\n- example\n  ```yaml\n  supersedes: []\n');
  git(['add', 'hub/list-fence-eof.md'], listFenceEofRepo);
  result = run(['check', '--root', listFenceEofRepo, ...COLLECTION], listFenceEofRepo);
  check('a list container may close its fence at end of file', result.status === 0, result.output);

  const invalidBacktickInfoRepo = join(work, 'invalid-backtick-info'); cpSync(repo, invalidBacktickInfoRepo, { recursive: true });
  write(invalidBacktickInfoRepo, 'hub/invalid-backtick-info.md', '# Invalid backtick info\n\n```yaml `invalid\nREC-ASDFGHJK\n');
  git(['add', 'hub/invalid-backtick-info.md'], invalidBacktickInfoRepo);
  result = run(['check', '--root', invalidBacktickInfoRepo, ...COLLECTION], invalidBacktickInfoRepo);
  check('backticks in a backtick-fence info string do not suppress record prefixes', result.status === 1
    && result.output.includes('record prefix REC-ASDFGHJK is unresolved'), result.output);

  const validTildeInfoRepo = join(work, 'valid-tilde-info'); cpSync(repo, validTildeInfoRepo, { recursive: true });
  write(validTildeInfoRepo, 'hub/valid-tilde-info.md', '# Valid tilde info\n\n~~~yaml `valid\nREC-QWERTYUI\n~~~\n');
  git(['add', 'hub/valid-tilde-info.md'], validTildeInfoRepo);
  result = run(['check', '--root', validTildeInfoRepo, ...COLLECTION], validTildeInfoRepo);
  check('backticks remain valid in tilde-fence info strings', result.status === 0, result.output);

  const deeperQuoteContentRepo = join(work, 'deeper-quote-content'); cpSync(repo, deeperQuoteContentRepo, { recursive: true });
  write(deeperQuoteContentRepo, 'hub/deeper-quote-content.md', '# Deeper quote content\n\n```yaml\n> REC-POIUYTRE\n```\n');
  git(['add', 'hub/deeper-quote-content.md'], deeperQuoteContentRepo);
  result = run(['check', '--root', deeperQuoteContentRepo, ...COLLECTION], deeperQuoteContentRepo);
  check('deeper blockquote markers remain content inside a top-level fence', result.status === 0, result.output);

  const nestedListFenceRepo = join(work, 'nested-list-fence'); cpSync(repo, nestedListFenceRepo, { recursive: true });
  write(nestedListFenceRepo, 'hub/nested-list-fence.md', '# Nested list fence\n\n- outer\n    - inner\n      ```yaml\n      REC-LKJHGFDS\n      ```\n');
  git(['add', 'hub/nested-list-fence.md'], nestedListFenceRepo);
  result = run(['check', '--root', nestedListFenceRepo, ...COLLECTION], nestedListFenceRepo);
  check('nested-list fenced record examples remain masked', result.status === 0, result.output);

  const tabListFenceRepo = join(work, 'tab-list-fence'); cpSync(repo, tabListFenceRepo, { recursive: true });
  write(tabListFenceRepo, 'hub/tab-list-fence.md', '# Tab list fence\n\n-\touter\n    ```yaml\n    REC-MNBVCXZL\n    ```\n');
  git(['add', 'hub/tab-list-fence.md'], tabListFenceRepo);
  result = run(['check', '--root', tabListFenceRepo, ...COLLECTION], tabListFenceRepo);
  check('tab-indented list fences use marker-relative columns', result.status === 0, result.output);

  const tabContinuationFenceRepo = join(work, 'tab-continuation-fence'); cpSync(repo, tabContinuationFenceRepo, { recursive: true });
  write(tabContinuationFenceRepo, 'hub/tab-continuation-fence.md', '# Tab continuation fence\n\n- outer\n  ```yaml\n\tREC-CXCVBNML\n\t```\n');
  git(['add', 'hub/tab-continuation-fence.md'], tabContinuationFenceRepo);
  result = run(['check', '--root', tabContinuationFenceRepo, ...COLLECTION], tabContinuationFenceRepo);
  check('tab expansion preserves list-fence continuation content', result.status === 0, result.output);

  const orderedInterruptionRepo = join(work, 'ordered-interruption'); cpSync(repo, orderedInterruptionRepo, { recursive: true });
  write(orderedInterruptionRepo, 'hub/ordered-interruption.md', '# Ordered interruption\n\nParagraph\n2. ```yaml\n   REC-AZERTYUI\n');
  git(['add', 'hub/ordered-interruption.md'], orderedInterruptionRepo);
  result = run(['check', '--root', orderedInterruptionRepo, ...COLLECTION], orderedInterruptionRepo);
  check('non-one ordered markers cannot hide prefixes by interrupting prose', result.status === 1
    && result.output.includes('record prefix REC-AZERTYUI is unresolved'), result.output);

  const emptyInterruptionRepo = join(work, 'empty-interruption'); cpSync(repo, emptyInterruptionRepo, { recursive: true });
  write(emptyInterruptionRepo, 'hub/empty-interruption.md', '# Empty interruption\n\nParagraph\n2.\n    ```yaml\n    REC-SDFGHJKL\n');
  git(['add', 'hub/empty-interruption.md'], emptyInterruptionRepo);
  result = run(['check', '--root', emptyInterruptionRepo, ...COLLECTION], emptyInterruptionRepo);
  check('empty list markers cannot hide prefixes by interrupting prose', result.status === 1
    && result.output.includes('record prefix REC-SDFGHJKL is unresolved'), result.output);

  const orderedOneFenceRepo = join(work, 'ordered-one-fence'); cpSync(repo, orderedOneFenceRepo, { recursive: true });
  write(orderedOneFenceRepo, 'hub/ordered-one-fence.md', '# Ordered one fence\n\nParagraph\n1. ```yaml\n   REC-DFGHJKLA\n');
  git(['add', 'hub/ordered-one-fence.md'], orderedOneFenceRepo);
  result = run(['check', '--root', orderedOneFenceRepo, ...COLLECTION], orderedOneFenceRepo);
  check('ordered-one list fences may interrupt prose', result.status === 0, result.output);

  const resumedPrefixRepo = join(work, 'resumed-prefix-scan'); cpSync(repo, resumedPrefixRepo, { recursive: true });
  write(resumedPrefixRepo, 'hub/resumed-prefix-scan.md', `# Closed example

\`\`\`yaml
supersedes: ["REC-ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
\`\`\`

Visible reference: REC-ZZZZZZZZ
`);
  git(['add', 'hub/resumed-prefix-scan.md'], resumedPrefixRepo);
  result = run(['check', '--root', resumedPrefixRepo, ...COLLECTION], resumedPrefixRepo);
  check('record-prefix scanning resumes after a valid fence closure', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const unterminatedFenceRepo = join(work, 'unterminated-prefix-fence'); cpSync(repo, unterminatedFenceRepo, { recursive: true });
  write(unterminatedFenceRepo, 'hub/unterminated-prefix-fence.md', `# Broken example

\`\`\`yaml
supersedes: []

REC-ZZZZZZZZ
`);
  git(['add', 'hub/unterminated-prefix-fence.md'], unterminatedFenceRepo);
  result = run(['check', '--root', unterminatedFenceRepo, ...COLLECTION], unterminatedFenceRepo);
  check('unterminated fences fail before they can suppress record references', result.status === 1
    && result.output.includes('unterminated Markdown fence in hub/unterminated-prefix-fence.md:3'), result.output);

}
