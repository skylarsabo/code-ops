# CI Portability

> The suite ships its CI as GitHub Actions workflows, and [08-ci-and-automation.md](../handbook/08-ci-and-automation.md) describes them in GitHub terms. Nothing in the gates is GitHub-specific except the plumbing. This guide translates the per-PR gates to **GitLab CI** and **CircleCI**, and marks exactly where the translation stops.

## What ports, and what does not

The repo runs four per-PR gates. They split cleanly in two:

| Gate | Kind | Ports? |
| --- | --- | --- |
| `validate` (structural lint, zero-dep guard, render checks, evals) | Mechanical — Node only, no credential, no network | **Yes.** Any host that runs Node 20 runs it unchanged. |
| `deep-review` (`rigor:deep-review`) | Agent review — needs a Claude credential and a host action | No. Shown below as an extension point. |
| `opsec-gate` (`privacy-opsec-suite:opsec-pr-gate`) | Agent review — same | No. Shown below as an extension point. |
| Breadth review (`code-ops-suite:pr-review`) | Agent review — same | No. Shown below as an extension point. |

The mechanical gate is the portable part, and it is also the important part: it needs no secret, so it protects the repo on fork branches and in any clone, and it is the deterministic backstop the model-backed gates sit on top of.

The agent gates are host-specific for one reason: they run through `anthropics/claude-code-action`, which is a GitHub Action. On another host you supply your own runner step — a container that has the Claude CLI, a credential in the host's secret store, and a way to post a comment through that host's API. That work is outside this repo, so the configs below carry the gate as a commented placeholder rather than a config that pretends to work.

The zero-dependency rule makes the port trivial in both directions: the suite imports only `node:` builtins ([`scripts/check-no-deps.mjs`](../../scripts/check-no-deps.mjs)), so a job needs a Node image and nothing else — no package install, no lockfile restore, no cache.

---

## The portable chain

Every host below runs the same commands. Take them from the repo's own workflow ([`.github/workflows/validate.yml`](../../.github/workflows/validate.yml)) rather than from this page, because that file is the source of truth and it grows. The core, in order:

```bash
node scripts/lint-plugins.mjs
node scripts/build-codex-marketplace.mjs --check
node scripts/build-opencode-dist.mjs --check
node scripts/check-no-deps.mjs
node scripts/check-doc-citations.mjs
node scripts/check-vault-standard.mjs code-ops-docs
for k in evals/*/ANSWER_KEY.json; do node evals/score.mjs "$k" --check; done
```

Then the eval harnesses under `evals/*/run.mjs`. Two constraints carry across hosts:

- **Node 20.** The scripts use modern `node:` APIs; pin the image, do not float it.
- **Full history for the diff-based checks.** `check-plugin-bump.mjs` and `check-gate-workflow-edit.mjs` diff against the merge base, so a shallow clone fails them. Each host has its own knob, marked below.

---

## GitLab CI

Save as `.gitlab-ci.yml` at the repo root.

```yaml
stages: [validate]

default:
  image: node:20

variables:
  # check-plugin-bump.mjs / check-gate-workflow-edit.mjs diff against the target
  # branch, so the default shallow clone is not enough.
  GIT_DEPTH: "0"

structural-lint:
  stage: validate
  script:
    - node scripts/lint-plugins.mjs
    - node scripts/build-codex-marketplace.mjs --check
    - node scripts/build-opencode-dist.mjs --check
    - node scripts/check-no-deps.mjs
    - node scripts/check-doc-citations.mjs
    - node scripts/check-vault-standard.mjs code-ops-docs
    - for d in evals/*/run.mjs; do echo "== $d =="; node "$d"; done
    - for k in evals/*/ANSWER_KEY.json; do echo "== $k =="; node evals/score.mjs "$k" --check; done
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

plugin-bump:
  stage: validate
  script:
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - node scripts/check-plugin-bump.mjs --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

# EXTENSION POINT — the agent review gates.
# There is no portable config for these: they need a Claude credential from the
# host secret store, a container carrying the Claude CLI, and a call to the
# GitLab notes API to post the verdict. Wire them as a job of your own that
# invokes /rigor:deep-review and /privacy-opsec-suite:opsec-pr-gate, and make it
# skip cleanly when the credential is absent, as the GitHub gates do.
# deep-review:
#   stage: validate
#   rules:
#     - if: $CI_PIPELINE_SOURCE == "merge_request_event"
#   script:
#     - '[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] || { echo "gate skipped"; exit 0; }'
#     - ...your runner...
```

Make it enforce: **Settings → Merge requests → Merge checks → Pipelines must succeed**, and mark the job as not allowed to fail (the default).

The equivalent of GitHub's concurrency cancellation is **Settings → CI/CD → General pipelines → Auto-cancel redundant pipelines**.

---

## CircleCI

Save as `.circleci/config.yml`.

CircleCI is the second example because it needs nothing this repo cannot provide: a stock Node image, no marketplace orb, no third-party dependency to install. Its job model also differs enough from GitLab's to show what the translation actually costs — which is one file and no changes to any script.

```yaml
version: 2.1

jobs:
  structural-lint:
    docker:
      - image: cimg/node:20.11
    steps:
      - checkout   # CircleCI checkout is full-history by default
      - run:
          name: Structural lint and render drift
          command: |
            node scripts/lint-plugins.mjs
            node scripts/build-codex-marketplace.mjs --check
            node scripts/build-opencode-dist.mjs --check
      - run:
          name: Zero-dependency guard and doc gates
          command: |
            node scripts/check-no-deps.mjs
            node scripts/check-doc-citations.mjs
            node scripts/check-vault-standard.mjs code-ops-docs
      - run:
          name: Eval harnesses
          command: |
            for d in evals/*/run.mjs; do echo "== $d =="; node "$d"; done
            for k in evals/*/ANSWER_KEY.json; do echo "== $k =="; node evals/score.mjs "$k" --check; done
      - run:
          name: Plugin version-bump gate (PR only)
          command: |
            if [ -z "$CIRCLE_PULL_REQUEST" ]; then echo "not a PR; skipping"; exit 0; fi
            git fetch origin main
            node scripts/check-plugin-bump.mjs --base origin/main

workflows:
  validate:
    jobs:
      - structural-lint

# EXTENSION POINT — the agent review gates.
# Same shape as the GitLab note above: supply a container with the Claude CLI,
# read the credential from a CircleCI context, invoke the review skill, and post
# the verdict through your VCS provider's API. Skip cleanly with exit 0 when the
# credential is absent so fork builds stay green.
```

Set the credential as an environment variable in a **Context**, not per project, so one rotation covers every repo.

---

## Porting checklist

1. Copy the command list from `.github/workflows/validate.yml`, not from this page.
2. Pin Node 20 and take a full-history checkout.
3. Run the whole chain in one job. It is fast, and a split buys nothing without a dependency install to cache.
4. Mark the job required in the host's branch-protection equivalent.
5. Leave the agent gates as a named, commented extension point until you have a runner for them. A gate that half-works is worse than a gate that is visibly absent.

---

## Related

- [08 · CI and automation](../handbook/08-ci-and-automation.md) — the full gate inventory and what each one blocks.
- [Wire CI gates](wire-ci-gates.md) — the GitHub walkthrough this guide mirrors.
- [Choosing an automation level](../techniques/choosing-an-automation-level.md) — `gated` / `auto-safe` / `auto-all` and the always-gated floor.
- [The evals directory](../../evals/README.md) — the harnesses the mechanical gate runs.

---

*Verified-at: e90fa84*
