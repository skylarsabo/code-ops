# Provenance: tau-prolog bench target

Upstream: https://github.com/tau-prolog/tau-prolog
Commit: 5bd606a255910d8e34ff1d721e80969af294b64c
License: BSD-3-Clause (`LICENSE`, upstream text, unchanged)
Vendored: 2026-10-14

## Taken from upstream

- `modules/`: 10 of the 11 `.js` files, byte-identical to the upstream blobs
  (LF line endings) except for the changes listed below: `charsio.js`,
  `concurrent.js`, `core.js`, `format.js`, `js.js`, `lists.js`, `os.js`,
  `promises.js`, `random.js`, `statistics.js`.
- `LICENSE`.

Left out: `modules/dom.js`, `taupl.js`, `examples/`, `lib/`, `logo/`, the docs
(`README.md`, `RELEASE_NOTES.md`, `TESTING.md`), and `package-lock.json`.
`modules/dom.js` is a browser module. Under Node, requiring it throws at
`dom.js` line 776, before the module function runs, so it cannot load there.

## Local changes to upstream files

The first group exists because `scripts/check-no-deps.mjs` accepts only
`node:`-prefixed builtins. Each specifier resolves to the same builtin.

- `modules/core.js` line 219: `require('fs')` became `require('node:fs')`.
- `modules/core.js` line 2561: `require("path")` became `require("node:path")`.
- `modules/core.js` line 2787: `require("fs")` became `require("node:fs")`.
- `modules/os.js` line 139: `require('child_process')` became `require('node:child_process')`.
- `modules/os.js` lines 180, 262, 300, 342, 392, 438, 487, 512, 543, 623, 666, 710:
  `require('fs')` became `require('node:fs')`.
- `modules/os.js` line 595: `require('path')` became `require('node:path')`.
- `modules/os.js` line 826: `require('process')` became `require('node:process')`.

The second group removes the one non-builtin dependency.

- `modules/core.js` line 288: `var readlineSync = require('readline-sync');`
  became a local object with the one method the next lines call,
  `question()`. It reads bytes from fd 0 with `node:fs` `readSync` until a
  newline or end of input and returns the line without the newline. The
  original `readline-sync` call used `keepWhitespace: true` and also read a
  line synchronously, so the stdin stream keeps its behaviour for piped input.
  It is used only when a program reads from `user_input`.

No other upstream byte changed. Seeds are applied only to the sandbox copy,
never to this tree.

## Authored here

- `package.json`: a minimal CommonJS manifest. `npm test` runs `node --test`.
- `test/characterization.test.js`: a node:test suite of 25 queries. Each
  consults a small program (the `lists`, `format`, and `charsio` libraries plus
  family, factorial, and color facts), collects every answer until the query
  fails, formats it with `pl.format_answer`, and compares the list to the
  recorded value. Text written to stdout by `format/2` is captured and compared.
- `test/expected.json`: the values recorded from the pristine source.

Run the suite with `node --test test/characterization.test.js`. Node 24 does
not accept a directory argument.

## Size

| File | Lines |
| --- | ---: |
| `modules/charsio.js` | 83 |
| `modules/concurrent.js` | 396 |
| `modules/core.js` | 9,101 |
| `modules/format.js` | 133 |
| `modules/js.js` | 558 |
| `modules/lists.js` | 471 |
| `modules/os.js` | 874 |
| `modules/promises.js` | 85 |
| `modules/random.js` | 224 |
| `modules/statistics.js` | 135 |
| Total runtime | 12,060 |

## Coverage note for seeding

The suite covers lists, arithmetic, `findall/3` and `bagof/3`, atom
conversion, `copy_term/2`, `format/2`, error reporting for unknown and
under-instantiated goals, and the consult path. A seed in a path it reaches
makes the suite fail, which `bench.mjs check` rejects. Seeds therefore go in
paths it does not reach, such as the `os`, `random`, `statistics`, `js`,
`promises`, and `concurrent` modules, `setof/3`, the term-ordering and
stream predicates, assert and retract, flags, and the parser's edge cases.
