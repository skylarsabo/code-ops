# PROGRAM: ledger demo

Grammar: 2

## Program goal

Ship the offline cache for the demo service and retire the legacy sync path.

## Request history

- 2026-09-10: build an offline cache for the demo service.
- 2026-09-18: retire the legacy sync path once the cache is live.

## Scope documents

- `design/cache.md` · Status: current · Role: design of the offline cache

## Finish line

- F1 The cache serves every read from disk when the network is down, shown by `npm run test:offline`.
- F2 The legacy sync path is deleted and no import of it remains.
- F3 The cache survives a restart with its entries intact, shown by `npm run test:restart`.

## Open items

- OI-1 cache read path: in progress · Owner: agent · Done when: offline reads hit the disk store · Blocks: F1
- OI-2 cache write path: in progress · Owner: agent · Done when: writes land in the disk store · Blocks: F1
- OI-3 eviction policy: designed · Owner: agent · Done when: the store stays under its size cap · Blocks: F1
- OI-4 migrate the config loader: open · Owner: agent · Done when: the loader reads the new keys · Blocks: F2
- OI-5 remove the sync client: open · Owner: agent · Done when: no import of the sync client remains · Blocks: F2
- OI-6 restart recovery: open · Owner: agent · Done when: a restart keeps every entry · Blocks: F3
- OI-7 corruption check on load: open · Owner: agent · Done when: a damaged store is rebuilt · Blocks: F3
- OI-8 offline test harness: open · Owner: agent · Done when: test:offline runs in CI · Blocks: F1
- OI-9 rename the cache module: open · Owner: agent · Done when: the module name matches the design
- OI-10 restart test harness: open · Owner: agent · Done when: test:restart runs in CI · Blocks: F3
- OI-11 delete the sync fixtures: open · Owner: agent · Done when: no sync fixture remains · Blocks: F2
- OI-12 cache metrics: open · Owner: agent · Done when: hit and miss counts reach the log · Blocks: F1
- OI-13 operator sign-off on the size cap: open · Owner: operator · Done when: the operator confirms 64 MB · Blocks: F1
- OI-14 release notes draft: open · Owner: agent · Done when: the notes list the removed sync path · Blocks: F2

## Decisions ledger

- DEC-1 2026-09-10 Store the cache as flat files, not a database · Rejected: sqlite · Hop: 0 · Disposition: local
- DEC-2 2026-09-12 Retry a failed disk write three times with 200 ms backoff · Rejected: no retry · Hop: 1 · Disposition: pending
- DEC-3 2026-09-14 Keep the cache key format from the old client · Rejected: a new hash key · Hop: 1
- 2026-09-16 Cap the store at 64 MB · Rejected: no cap · Hop: 1 · Disposition: pending
- DEC-5 2026-09-24 Retry a failed disk write five times with 500 ms backoff, replacing the earlier ruling to retry three times with 200 ms backoff because three tries lost writes under load · Rejected: three tries, no retry · Hop: 2 · Disposition: pending
- DEC-6 2026-09-25 Store entries compressed · Supersedes: DEC-1 · Rejected: flat uncompressed files · Hop: 2 · Disposition: pending

## Closed items

- OI-0 repo scaffold · closed by commit 3f2a1b9 · Pointer: package.json
