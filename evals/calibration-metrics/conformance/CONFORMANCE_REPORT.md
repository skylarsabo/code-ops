# Conformance report — fixture

| surface | verdict | checker | evidence |
| --- | --- | --- | --- |
| contract | CONFORMANT | byte-identical pair check | pair matches, routing section present |
| vault | DRIFTED | check-vault-standard.mjs | 3 notes carry no `type` frontmatter |
| atlas | UNKNOWN | atlas-check.mjs check | manifest did not parse |
| doc-alignment | ABSENT | none | no drift signal raised, surface not assessed |
| global-contract | not-a-verdict | none | malformed row: verdict outside the four |
| contract | DRIFTED | byte-identical pair check | duplicate surface: first row wins |
| runs-folder | conformant | none | lowercase verdict parses |
