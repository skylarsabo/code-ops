# Conformance report — fixture

| surface | verdict | checker | evidence |
| --- | --- | --- | --- |
| contract | CONFORMANT | byte-identical pair check | pair matches, routing section present |
| vault | DRIFTED | check-vault-standard.mjs | 3 notes carry no `type` frontmatter |
| atlas | UNKNOWN | atlas-check.mjs check | manifest did not parse |
| doc-alignment | ABSENT | none | no drift signal raised, surface not assessed |
| global-contract | PARTIAL | none | malformed row: verdict outside the four |
| shape-broken | NOT A VERDICT | none | malformed row: shape does not match the grammar |
