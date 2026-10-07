# File and line links

An operative report cites code by file and line. This page states the one link form every report uses, so a reader can open the line and a checker can resolve it.

## The form

Write each citation as `[name](repo-relative/path:line)`. The link text names the file and line. The target is the repository-relative path, a colon, and one line number.

Example: `[src/file.ts:42](src/file.ts:42)`.

## Rules

- Use a path relative to the repository root. Never use an absolute path or a `../` path.
- Cite one line. Name a range as two citations.
- Give the file name an extension that the checker knows, such as `.ts`, `.mjs`, `.md`, `.json`, or `.yml`.
- Quote the verbatim anchor after the link when the citation supports a claim: `Anchor: ` followed by a delimited substring of that line.
- Write a plain `path:line` when the surface cannot render a link, such as a terminal report.

## What checks the form

No lint check in `scripts/lint-plugins.mjs` or `evals/lint-plugins/run.mjs` pins the link form. The grammar sits in `REF_RE` at `scripts/citation-lib.mjs:30`. That pattern reads `path:line` in prose, in a backtick span, and inside a markdown link target. `evals/script-guards/run.mjs:199` pins the markdown link case.

A citation is FRESH when the cited line still holds the anchor. It is MOVED, DRIFTED, or GONE otherwise. `scripts/revalidate-register.mjs` and `scripts/atlas-check.mjs` classify each citation this way.

## Who follows it

The `explorer`, `reviewer`, and `mech` agents return reports that cite code. Each names this page in its Return section. [Evidence and tiers](../05-evidence-and-tiers.md) explains why every claim carries a citation.
