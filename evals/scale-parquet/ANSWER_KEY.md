# scale-parquet: answer key

A Parquet reader (`repo/`, about 6,100 source lines) with **18 planted defects** and **10 decoys**, derived by `build.mjs` from the bench target and its bug-hunt seeds. Each defect fails a hidden oracle; each decoy is an equivalent rewrite whose oracle passes. Do not hand-edit: run `node evals/scale-parquet/build.mjs`.

Keep this file, `ANSWER_KEY.json`, `build.mjs`, and `evals/bench/` out of any context you give the skill: the bench target is the unseeded source, so a diff against it reveals every seed.

Pass bar: recall at least 50% and at most 0 decoy flagged, matched within 3 lines.

## Planted defects (should be found)
| ID | Location | Category | What changed |
|----|----------|----------|--------------|
| bh-scan-candidate-edge | `src/scan.js:252` | off-by-one | `} else if (rowStart >= candidate.rowEnd) {` became `} else if (rowStart > candidate.rowEnd) {` |
| bh-scan-column-await | `src/scan.js:193` | missing-await | `const result = await asyncColumn.data` became `const result = asyncColumn.data` |
| bh-or-group-skip | `src/filter.js:124` | inverted-guard | `return filter.$or.every(subFilter => canSkipRowGroup(` became `return filter.$or.some(subFilter => canSkipRowGroup(` |
| bh-strict-default | `src/read.js:35` | wrong-default | `filter, filterStrict = true } = options` became `filter, filterStrict = false } = options` |
| bh-bloom-truncated-silent | `src/bloom.js:96` | swallowed-error | `` throw new Error(`parquet bloom filter truncated: need ${numBytes} bytes, have ${view.byteLength - offset}`) `` became `return undefined` |
| bh-equals-bytes-length | `src/utils.js:58` | missing-guard | removes `if (a.length !== b.length) return false` |
| bh-chunk-row-end | `src/read.js:80` | off-by-one | `rowEnd: rowStart + columnData.length,` became `rowEnd: rowStart + columnData.length - 1,` |
| bh-cache-slice-end | `src/scan.js:87` | wrong-variable | `rowEnd - cached.rowStart` became `rowEnd - cached.rowEnd` |
| bh-bloom-skip-inverted | `src/filter.js:158` | inverted-guard | `if (hash !== undefined && !sbbfContains(bloom.blocks, hash)) return true` became `if (hash !== undefined && sbbfContains(bloom.blocks, hash)) return true` |
| bh-scan-range-reversed | `src/scan.js:269` | unsafe-input | `if (!Number.isSafeInteger(rowEnd) \|\| rowEnd < rowStart) {` became `if (!Number.isSafeInteger(rowEnd)) {` |
| bh-unknown-leaf-filter | `src/filter.js:135` | missing-guard | removes `if (columnIndex === -1) continue` |
| bh-offset-index-fields | `src/indexes.js:41` | wrong-variable | `compressed_page_size: loc.field_2,` / `first_row_index: loc.field_3,` became `compressed_page_size: loc.field_3,` / `first_row_index: loc.field_2,` |
| bh-delta-33bit-zigzag | `src/delta.js:134` | off-by-one | `reader.view.getUint8(start + 4) >>> 4 & 1 : 0` became `reader.view.getUint8(start + 4) >>> 3 & 1 : 0` |
| bh-page-range-touch | `src/plan.js:232` | off-by-one | `if (pageEnd > rangeStart && pageStart < rangeEnd) {` became `if (pageEnd >= rangeStart && pageStart < rangeEnd) {` |
| bh-stats-gte-edge | `src/filter.js:203` | off-by-one | `if (operator === '$gte' && relationalBoundsAreSafe && maxComparison !== undefined && maxComparison < 0) return true` became `if (operator === '$gte' && relationalBoundsAreSafe && maxComparison !== undefined && maxComparison <= 0) return true` |
| bh-rle-width-bytes | `src/encoding.js:49` | off-by-one | `const width = bitWidth + 7 >> 3` became `const width = bitWidth + 8 >> 3` |
| bh-split-stream-layout | `src/encoding.js:124` | wrong-order | `bytes[i * width + b] = reader.view.getUint8(reader.offset++)` became `bytes[b * count + i] = reader.view.getUint8(reader.offset++)` |
| bh-column-start-zero | `src/plan.js:136` | wrong-default | `const columnOffset = meta.dictionary_page_offset \|\| meta.data_page_offset` became `const columnOffset = meta.dictionary_page_offset ?? meta.data_page_offset` |

## Decoys (should NOT be flagged)
| ID | Location | Category | Why it is fine |
|----|----------|----------|----------------|
| bh-intersect-advance-tie | `src/filter.js:366` | off-by-one | an equivalent rewrite that keeps its oracle green: `if (a[i][1] < b[j][1]) i++` became `if (a[i][1] <= b[j][1]) i++` |
| bh-projection-redundant-columns | `src/read.js:121` | missing-guard | an equivalent rewrite that keeps its oracle green: `if (requiresProjection && columns) {` became `if (requiresProjection) {` |
| bh-query-return-await | `src/query.js:95` | missing-await | an equivalent rewrite that keeps its oracle green: `return await parquetReadObjects(options)` became `return parquetReadObjects(options)` |
| bh-query-metadata-alias | `src/query.js:29` | wrong-variable | an equivalent rewrite that keeps its oracle green: `const allColumns = parquetSchema(options.metadata).children.map(c => c.element.name)` became `const allColumns = parquetSchema(metadata).children.map(c => c.element.name)` |
| bh-filter-limit-break | `src/query.js:47` | off-by-one | an equivalent rewrite that keeps its oracle green: `if (filteredRows.length >= rowEnd) break` became `if (filteredRows.length > rowEnd) break` |
| bh-tojson-branch-order | `src/utils.js:18` | wrong-order | an equivalent rewrite that keeps its oracle green: swaps the order of `if (obj instanceof Uint8Array) return Array.from(obj)` and `if (obj instanceof Date) return obj.toISOString()` |
| bh-literal-condition-form | `src/filter.js:65` | inverted-guard | an equivalent rewrite that keeps its oracle green: `if (typeof condition !== 'object' \|\| condition === null \|\| Array.isArray(condition)) {` became `if (!(typeof condition === 'object' && condition !== null && !Array.isArray(condition))) {` |
| bh-bloom-int64-wrap | `src/bloom.js:159` | missing-guard | an equivalent rewrite that keeps its oracle green: `setBigUint64(0, BigInt.asUintN(64, bigValue), true)` became `setBigUint64(0, bigValue, true)` |
| bh-coalesce-touching | `src/plan.js:441` | off-by-one | an equivalent rewrite that keeps its oracle green: `if (last && range.startByte <= last.endByte + maxGap &&` became `if (last && range.startByte < last.endByte + maxGap + 1 &&` |
| bh-read-return-promise | `src/read.js:61` | missing-await | an equivalent rewrite that keeps its oracle green: `await awaitAllColumns(asyncGroups)` / `return` became `return awaitAllColumns(asyncGroups)` |
