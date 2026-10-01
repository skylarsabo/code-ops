# Tasks

- [ ] OI-1 cache read path: in progress · Owner: agent · Done when: offline reads hit the disk store · Blocks: F1
- [ ] OI-2 cache write path: in progress · Owner: agent · Done when: writes land in the disk store · Blocks: F1
- [ ] OI-3 eviction policy: designed · Owner: agent · Done when: the store stays under its size cap · Blocks: F1
- [x] OI-4 migrate the config loader: landed in commit 7be44d0 · Owner: agent · Done when: the loader reads the new keys · Blocks: F2
- [ ] OI-5 remove the sync client: open · Owner: agent · Done when: no import of the sync client remains · Blocks: F2
- [ ] OI-6 restart recovery: open · Owner: agent · Done when: a restart keeps every entry · Blocks: F3
- [ ] OI-7 corruption check on load: open · Owner: agent · Done when: a damaged store is rebuilt · Blocks: F3
- [ ] OI-8 offline test harness: open · Owner: agent · Done when: test:offline runs in CI · Blocks: F1
- [ ] OI-9 rename the cache module: open · Owner: agent · Done when: the module name matches the design
- [ ] OI-10 restart test harness: open · Owner: agent · Done when: test:restart runs in CI · Blocks: F3
- [ ] OI-11 delete the sync fixtures: open · Owner: agent · Done when: no sync fixture remains · Blocks: F2
- [ ] OI-12 cache metrics: open · Owner: agent · Done when: hit and miss counts reach the log · Blocks: F1
- [ ] OI-13 operator sign-off on the size cap: open · Owner: operator · Done when: the operator confirms 64 MB · Blocks: F1
- [ ] OI-14 release notes draft: open · Owner: agent · Done when: the notes list the removed sync path · Blocks: F2
