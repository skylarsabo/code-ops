# The house writing standard

Every artifact this marketplace produces is read under load: a reviewer at the end of a
long day, a future maintainer with no context, a model parsing prose into action. The
standard below exists so that reader never has to work out what we meant.

It derives from ASD-STE100 Simplified Technical English, adapted for software. The spec
itself is licensed and is not redistributed here; only the derived rules live in this
repo. Four principles from Zinsser decide every case the rules do not cover: clarity,
simplicity, brevity, humanity.

## The four principles are the tie-breaker

Rules serve the principles, not the reverse.

- **Clarity beats conformance.** If a rule makes a sentence harder to understand, break
  the rule and say why. A conformant sentence that misleads has failed.
- **Simplicity.** Cut the clause that adds nothing. Prefer the plain word.
- **Brevity.** The word caps below are the floor of brevity, not the whole of it. A
  compliant paragraph that says nothing is still waste.
- **Humanity.** Write to a person. Standardized language is not impersonal language, and
  it never becomes an excuse for prose with no author behind it.

## Sentences

- Instructions run to 20 words. Explanation runs to 25.
- One instruction per sentence. Split a chained instruction into separate steps.
- Write instructions in the imperative.
- When a condition governs an instruction, state the condition first, then a comma, then
  the command.
- Use the active voice. Passive is allowed only when the actor is genuinely unknown.
- Do not use semicolons. Write two sentences.
- Keep the subject, the verb, and the articles. Do not compress by deleting them.
- Expand contractions in artifacts. Chat may keep them, because humanity outranks the
  rule there.

## Paragraphs

- One topic per paragraph.
- Six sentences per paragraph. Past six, split it.
- Open with the sentence that announces the topic. A reader who reads only the opening
  sentences must still get a usable outline.

## Words

- **One term per concept, every time.** This rule is the point of the standard. Two
  sentences can both be correct and still be wrong to alternate between. Pick the term,
  then never vary it inside a document or a run.
- Define a domain term once, at first use, then use it unchanged.
- Cap noun stacks at three words. Break longer ones with prepositions.
- Do not turn a noun into a verb. Do not turn a verb into a noun.
- Do not use a phrasal verb where one verb exists. Prefer "cancel" over "call off".
- Write Latin abbreviations out: "for example", "that is", "and so on".
- Keep "that" as a clause marker rather than dropping it.
- Make every "this" bind to a named referent. If it could point at two things, restate
  the noun.
- Use American spelling and gender-neutral language.

## Lists

- Convert an enumeration of three or more items into a vertical list.
- End the lead-in with a colon. The lead-in counts against the sentence cap, and each
  item counts as its own sentence under the same cap.
- Keep lists to one level. Flatten a nested list into its parent item.
- Do not mix instructions and description in one list.

## Mannered prose

Mannered prose substitutes metaphor and flourish for direct statement: "a dial worth
turning" for "a parameter worth varying", "earns its keep" for "still matters". The
phrase displays the writer instead of conveying the idea, and it drags in connotations the
writer did not choose. When a literal phrase exists, use it. The narration scanner reports
the common forms as an advisory.

## Formatting

- Use lists and headers when the content is multifaceted enough that they help, or when
  the reader asks for them.
- When the reader asks for minimal formatting, use none.
- In a conversational exchange, keep to plain prose.
- Bold the first words of a bullet, never a whole sentence.

## The adaptation for code

The source standard was written for aircraft maintenance manuals. These clauses replace
the parts that do not survive the move to software.

- **Identifiers are atomic.** A path, symbol, command, flag, version, or quoted output
  counts as one word and is exempt from every vocabulary rule. Never reword an identifier
  to fit a limit, and never break one across a line to satisfy a cap.
- **Code blocks are exempt.** Word caps, tense rules, and vocabulary rules stop at the
  fence.
- **Destructive-action callouts** replace the source standard's hazard taxonomy. State
  the command first, then the consequence, then whether it is reversible. Use two levels:
  irreversible effect (data loss, published output, external side effect) and recoverable
  damage.
- **Commit subjects** use the imperative, carry no trailing period, and name the change
  rather than the activity.
- **Findings and evidence** cite `file:line`. A claim with no citation is labelled an
  inference, in the words of the sentence itself.

## What this standard does not adopt

Reject these deliberately, and do not let a reviewer reintroduce them.

- **The controlled dictionary.** The source standard's spine is a list of approved words
  with approved senses and approved parts of speech. No equivalent exists for software,
  and inventing one would cost more than it returns. The one-term-per-concept rule above
  carries the same intent at a fraction of the cost.
- **The six-verb-form restriction.** The source standard permits only infinitive,
  imperative, simple present, simple past, simple future, and participial adjectives. In
  this work the perfect and progressive tenses carry real distinctions: "the gate has
  passed" is not "the gate passed", and "the run is executing" is not "the run executes".
  Dropping them would buy conformance with clarity, which inverts the first principle.
- **The aerospace category taxonomies.** The noun and verb categories in the source
  standard classify aircraft systems and maintenance actions. They do not transfer.

## Where it applies

It binds every written output: chat replies, commit messages, PR bodies, findings
registers, calibration notes, skill and agent prose, documentation, and code comments.

The counted limits (sentence length, paragraph length) are enforced on artifacts. Chat
replies follow every rule except the counted cap, because a conversation that stops to
count words has traded humanity for a number.

Code identifiers, quoted tool output, and generated tables are exempt everywhere.
