---
name: ship
description: "Use when you want to implement one change, a feature or a one-off, end to end at high quality, shipped as a clean traceless PR."
---

# Ship: implement one change end-to-end, at full rigor

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:ship`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin: the operating model, the interaction protocol, the safety rails
including the automation-level ladder (`§4`), the quality lenses (`§10`), and the implementation
loop (`§11`) this skill follows.
**Mode:** IMPLEMENT. **Consumes:** an intent, meaning a ticket, a request, or a spec.
**Produces:** the change, proven and shipped as a clean, traceless PR or stack. **Composes,** when
installed: `rigor` for the safety net, the proof, and the regression guard,
`privacy-opsec-suite` for the leak gate, and `code-ops-suite:pr-split` plus
`privacy-opsec-suite:authorship-hygiene` for the traceless finish. **Requires `rigor`.** The
privacy phase runs only when `privacy-opsec-suite` is installed and the change touches a privacy
surface.

Scale every phase to the change. A one-off is a light pass, and a feature gets the full
treatment.

## Phase 0: the scope and the design-check  *(checkpoint)*

Run `node <plugin-root>/scripts/preflight.mjs --artifact-dir <run folder>`, adding
`--need gh` when the run will publish. A FAIL stops the run before fan-out. Confirm plugin
availability. Prepare one exact context snapshot and compile the explorer's scoped bundle.
Context drift or an explicit compiler marker stops dispatch and triggers a replan. Hand the
verified bundle to the explorer, then run `rigor:ground-truth` for the baseline.

Size the change as a one-off or a feature. For a feature, confirm the approach before building. A
true one-off proceeds. Set the **automation level** (`§4`).

Ask one more question at this checkpoint: **run the model review gates on this change?** The
default is no. Recommend yes only when the diff will touch a high-risk surface (security or auth,
egress or logging, data migrations, public contracts, or gate scripts), or when the operator has
asked for a reviewed change. Record the answer, because it governs Phase 5.

## Phase 1: the safety net, for risky or low-coverage areas

When the change touches code with thin coverage, run `rigor:safety-net` to characterize current
behavior first, so the change is provably behavior-preserving where it should be.

## Phase 2: the implementation

Run the implementation loop (`§11`): the smallest correct change, matching the existing
conventions and upholding the quality lenses (`§10`). A feature ships its smallest valuable slice
first, behind a flag when it is not yet complete. Do not trade one issue for another. Route a
new-dependency or library-choice decision through `researcher:library-eval`. Route a claim or
assumption needing verification before a design commitment through `researcher:research-verify`.

Climb the code-economy ladder before writing new code, and record a deliberate simplification
with a `deferred(<ceiling>, <upgrade path>)` marker. The mechanical floor under that rule is
`node <plugin-root>/scripts/co.mjs scan overbuild --git <range>` over the change's own
range. It blocks only on an unrecorded dependency, and its other tells are leads.

## Phase 3: the proof

Add tests that fail before the change and pass after it. Keep the full suite green. Run the
regression guard (`rigor §H`) so nothing prior breaks. A change without a test that demonstrates
it is not done.

Before trusting any composed skill's or dispatched operative's report, at this phase or a later
one, check that it has the shape its role promises, such as a proof artifact from `rigor`'s
verifier or a leak verdict from the privacy gate. Anything null, empty, or short of that shape is
a failed dispatch (`§1`). Log it `failed` in `DISPATCH_LEDGER.md` (`§12`) and redispatch or defer
it. Never treat it as a pass.

## Phase 4: the privacy gate  *(when applicable)*

When the change touches egress, logging, identifiers, or a default, and `privacy-opsec-suite` is
installed, run `privacy-opsec-suite:metadata-leak-audit` scoped to the change's diff. It must
find no new leak, egress, identifier, or fingerprint, with fail-closed behavior preserved. Its
findings enter `FINDINGS_REGISTER.md`. Surface any anonymity regression as blocking.

## Phase 5: the local review and the traceless finish

Commit the final intended diff. Run the deterministic gate chain and read the diff yourself. That
read is the review every change gets.

Only when the Phase 0 answer was yes, run `code-ops-suite:local-review-gate` before the PR exists.
Its exact-SHA plan composes both local review roles, records both reports, and refuses stale or
incomplete receipt coverage. A fix changes HEAD and requires both reviews again. Never start the
model gates on your own judgment. A change that turns out to touch a high-risk surface goes back
to the operator with the recommendation, not straight into review.

Ship the work as a clean PR. Use `code-ops-suite:pr-split` when it warrants a stack, and
otherwise a single PR scrubbed by `privacy-opsec-suite:authorship-hygiene`. `scan-ai-tells`
passes fail-closed before push. When `privacy-opsec-suite` is not installed, run the bundled
`<plugin-root>/scripts/co.mjs scan ai-tells` over the commit and PR text directly as the
gate. Push the branch, publish the local receipt statuses for that exact SHA when the gates ran,
and only then open the PR. Hosted CI runs deterministic checks only, and is the required merge
gate. **Never auto-merge.**

When the repo carries an atlas (`code-ops-docs/98 System/Atlas/MANIFEST.json`, or
`atlas/MANIFEST.json`), close the loop on it here. Run
`node <plugin-root>/scripts/atlas-check.mjs check --atlas <atlas dir>`. For any section
this change turned STALE, refresh and stamp it **in this session**. The rationale behind the diff
is hot now and unrecoverable later, which is why the update belongs to the change that caused it
rather than to a future reader. When a full section rewrite is out of scope for this change,
append the observation with the `inbox` subcommand and leave the section STALE instead.

## Done when

- The change is implemented at the smallest correct scope.
- It is proven, with failing-then-passing tests and the suite and regression guard green.
- It is behavior-preserving where intended, and the privacy posture is intact.
- The lead reviewed the final committed diff, and the model gates ran only when the operator opted in.
- The docs are updated.
- The work shipped as a clean, trace-free PR or stack, with nothing auto-merged.
- The local receipt identity, the summary, the PR links, and anything left for your decision are presented.
