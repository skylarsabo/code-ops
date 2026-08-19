# Working on beta (fixture)

A fixture repo used by `evals/fleet-standard/run.mjs`. It stands in for a consenting fleet
member in the pointer parity mode, carrying no vault.

## Fleet

FLEET MEMBER: YES

The phrase is upper-cased here on purpose: the checker matches it case-insensitively, and a
fixture that only ever spelled it one way would let a case-sensitive regression pass.

## Documentation

Beta has no vault. The fleet checker reports that surface as absent, because vault adoption
stays voluntary.
