# Provenance: hyparquet bench target

Upstream: https://github.com/hyparam/hyparquet
Commit: 2a4b96cc04ca0ac268596302667d39e2d505b560
License: MIT (`LICENSE`, upstream text, unchanged)
Vendored: 2026-10-14

## Taken from upstream

- `src/`: all 28 files (27 `.js` files and `types.d.ts`).
- `LICENSE`.
- `data/`: 8 test files from upstream `test/files/`: `bloom_filter.parquet`,
  `byte_array_decimal.parquet`, `datapage_v2.snappy.parquet`,
  `delta_encoding_optional_column.parquet`, `dictionary_offset_indexed.parquet`,
  `geospatial.parquet`, `nullable.impala.parquet`, `shredded-object.parquet`.

Two other downloaded files were dropped: `delta_length_byte_array.parquet` and
`rle_boolean_encoding.parquet`. They need ZSTD or GZIP decoders, which the
upstream core does not include.

## Local changes to upstream files

- `src/node.js` line 5: `from 'fs'` became `from 'node:fs'`. The two specifiers
  resolve to the same builtin. The change is needed because
  `scripts/check-no-deps.mjs` accepts only `node:`-prefixed builtins.

No other upstream byte changed. Seeds are applied only to the sandbox copy,
never to this tree.

## Authored here

- `package.json`: a minimal manifest. `npm test` runs `node --test`.
- `test/characterization.test.js`: a node:test suite. It reads each data file
  end to end and checks the row count, the leaf column names, and a SHA-256
  digest of the rows as canonical JSON.
- `test/expected.json`: the values recorded from the pristine source.

Upstream tests are not vendored (see the design doc appendix).

## Size

There are 5,508 physical lines in `src/*.js`. Of these, 1,346 are comment
lines and 399 are blank, which leaves about 3,760 code lines.

## Coverage note for seeding

The visible suite exercises full-file decode paths only. A seed in a path
the suite exercises makes the suite fail, which `bench.mjs check` rejects.
Seeds therefore go in paths the 8 files do not reach, such as row ranges,
column selection, filters, query planning, and edge options.

## Open for build step 4

The sandbox copy policy must decide whether `LICENSE` and this file ship
into the sandbox.
