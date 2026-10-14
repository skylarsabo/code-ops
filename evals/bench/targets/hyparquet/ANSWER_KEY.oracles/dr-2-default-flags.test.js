import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery, parquetReadObjects } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
/** Ascending order that matches the JS relational operators. */
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0
const isMissing = (v) => v === null || v === undefined
/** Expected order: present values sorted, missing values on the requested side. */
function arrange(values, { descending = false, nullsFirst = false } = {}) {
  const present = values.filter(v => !isMissing(v)).sort((a, b) => descending ? cmp(b, a) : cmp(a, b))
  const missing = values.filter(isMissing).map(() => null)
  return nullsFirst ? [...missing, ...present] : [...present, ...missing]
}

test('parquetQuery sorts ascending with missing values last when no flag is set', async () => {
  const file = load('delta_encoding_optional_column')
  const all = await parquetReadObjects({ file })
  const years = all.map(r => r.c_birth_year)
  const want = arrange(years)
  for (const flags of [{}, { descending: false, nullsFirst: false }, { descending: undefined, nullsFirst: undefined }]) {
    const plain = await parquetQuery({ file, orderBy: 'c_birth_year', columns: ['c_birth_year'], ...flags })
    assert.deepEqual(plain.map(r => r.c_birth_year ?? null), want, JSON.stringify(flags))
    const filtered = await parquetQuery({ file, filter: { c_customer_sk: { $gte: 1 } }, orderBy: 'c_birth_year', columns: ['c_birth_year'], ...flags })
    assert.deepEqual(filtered.map(r => r.c_birth_year ?? null), want, 'filtered ' + JSON.stringify(flags))
  }
})
