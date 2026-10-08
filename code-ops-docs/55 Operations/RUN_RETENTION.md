---
type: reference
status: current
updated: 2026-10-07
---

# Run retention tiers

## Scope

This page defines how the repository dates a run folder under `code-ops-docs/80 Runs/` and which retention tier the age gives it. The tiers classify folders. They never delete, move, or archive one. A later step, such as a distill pass, reads the tier and acts under its own rules.

## Tiers

| Tier | Age in days | Meaning |
| --- | --- | --- |
| `active` | 0 to 30 | A recent run. Leave it where it is. |
| `distill-ready` | 31 to 180 | A run old enough for a distill pass to read. |
| `archive` | 181 or more | A run old enough to archive after distillation. |

The limits are the constants `RUN_TIER_DAYS` in `scripts/docs-manifest.mjs:347` (`active: 30`, `distillReady: 180`). Each limit belongs to the younger tier, so age 30 is `active` and age 180 is `distill-ready`. The eval `evals/docs-manifest/run.mjs` tests both sides of each limit.

## How a folder gets its age

1. The folder name starts with `YYYY-MM-DD` and that date exists on the calendar. The age is the count of whole UTC days from that date to today.
2. The name has no valid date prefix, such as `legacy` or `2026-02-30-x`. The age is the count of whole UTC days from the folder mtime to today.

The name date wins over the mtime, because a touched folder keeps its true date. A folder dated in the future gets age 0. The report column `source` shows `name` or `mtime` for each folder.

## Report

```
node scripts/docs-manifest.mjs runs [--root <repo>] [--now <YYYY-MM-DD>]
```

The command lists each directory directly under `<hub>/80 Runs/` by tier, oldest first, with its age, its source, and its name. Plain files such as `INDEX.md` are skipped. `--now` fixes today for a repeatable report. The command reads the file system and writes nothing.

## Run index

```
node scripts/check-vault-standard.mjs <hub> --render [--now <YYYY-MM-DD>]
```

On a manifest v3 hub, `--render` also writes `80 Runs/INDEX.md` when that folder exists. The page is generated, so nobody edits it, and the `80 Runs/` ignore rule keeps it out of git. It lists each run folder (dot folders excluded) newest first with its tier, its age, its retention class (`evidence`, `working`, or `-` for a run that records none), a status, and relative links to `RUN_LOG.md`, `TASKS.md`, and `reports/` where they exist. The tier and age come from `listRunTiers`, so the page adds no age rule. The status is the last `Verdict:` or `Status:` line of the first of `CLOSEOUT.md`, `EXECUTIVE_SUMMARY.md`, `RUN_LOG.md`, and `TASKS.md` that has one, else the `TASKS.md` checkbox count such as `2/3 tasks done`, else `-`. No artifact needs a new format. Check mode never compares the page, because ages move each day, and it exempts the page from the note rules only while the page carries the generated marker. A hub that tracks its run folders in git must also ignore `80 Runs/INDEX.md`.

## Source of the rules

No committed document defined these tiers before this page. The tier names, the 30-day and 180-day limits, and the mtime fallback come from the design reports of the program redesign run (`2026-10-06-program-redesign`, `reports/D-003.md` line 21 and `reports/D-019.md` lines 36 and 88). That run folder is not tracked, so this page is the committed record. The operator has not yet ratified the limits. Change them in `RUN_TIER_DAYS` and in the table above in one commit.

## Relation to retention classes

The design in `10 Design/Docs state and history 2026-09.md` ("Retention by run class") sets a per-run class, `evidence` or `working`. `co run open --retention` records it in `SESSION.json`, and `co run retention-check` fails a `working` run that a tracked file cites (`code-ops-docs/35 Contracts and Data/CONTRACTS.md`, "Run retention classes"). Age and class are separate. An age tier never lowers a class, and a cited run stays whatever its class says. This page adds no class.
