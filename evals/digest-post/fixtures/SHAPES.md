# Tool response shapes pinned by the digest-post eval

Derived on 2026-10-08 from the `toolUseResult` rows of local session transcripts. The
fixtures here hold synthetic text and the real key names. No transcript text, path, or
value is copied. The eval (`evals/digest-post/run.mjs`) fails when a fixture's keys drift
from the lists below.

## Bash

The PostToolUse `tool_response` for Bash carries these keys, in this order:

| Key | Type |
| --- | --- |
| `stdout` | string |
| `stderr` | string |
| `interrupted` | boolean |
| `isImage` | boolean |
| `noOutputExpected` | boolean |

Transcript rows also show optional keys: `bashEditDiff`, `gitOperation`,
`returnCodeInterpretation`, `backgroundTaskId`, `backgroundCwdHint`, `timedOutAfterMs`,
`persistedOutputPath`, and `persistedOutputSize`. The digest copies every key it does not
replace. A result with `persistedOutputPath` is left alone, because the host already moved
its full output to a file.

The digest replaces `stdout` and `stderr` only. The trailer sits at the end of `stdout`.

## Read

A text read has this shape:

| Key | Type |
| --- | --- |
| `type` | string, `text` |
| `file.filePath` | string |
| `file.content` | string |
| `file.numLines` | number |
| `file.startLine` | number |
| `file.totalLines` | number |

The digest replaces `file.content` only. `numLines`, `startLine`, and `totalLines` keep
describing the file on disk. A result without a string `file.content` (for example an
unchanged-file marker) is left alone. Read digest is off unless `CODE_OPS_DIGEST_READ` is
`1`, `on`, `true`, or `yes`.

## Fixtures

| File | Use |
| --- | --- |
| `bash-compound.json` | pipeline-style rows with one error line, 5.9 KB, between the two thresholds |
| `bash-tests.json` | TAP-style roll call with one failure and a stderr stream |
| `bash-longline.json` | one 6000-character line |
| `bash-small.json` | under every threshold |
| `bash-digested.json` | output that already ends with the CLI trailer |
| `read-text.json` | a 300-line text read |
