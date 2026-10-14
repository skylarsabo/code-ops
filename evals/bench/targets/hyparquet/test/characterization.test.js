// Characterization suite: locks the pristine reader's output on the vendored data files.
// Each case reads one file end to end and compares the row count, the schema column
// names, and a SHA-256 digest of the canonical JSON of every row against the values
// recorded from the pristine source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetMetadata, parquetReadObjects, parquetSchema } from '../src/index.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** Canonical JSON: bigint, typed arrays, and dates get stable text forms. */
function canonical(value) {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === 'bigint') return `${v}n`
    if (v instanceof Date) return `date:${v.toISOString()}`
    if (ArrayBuffer.isView(v)) return Array.from(/** @type {ArrayLike<number>} */ (v))
    return v
  })
}

/** @param {string} text */
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** @param {import('../src/types.d.ts').SchemaTree} tree */
const leafNames = (tree) => tree.children.length
  ? tree.children.flatMap(leafNames)
  : [tree.path.join('.')]

export async function summarize(name) {
  const file = load(name)
  const metadata = parquetMetadata(file)
  const rows = await parquetReadObjects({ file })
  return {
    rows: rows.length,
    columns: leafNames(parquetSchema(metadata)),
    digest: sha256(canonical(rows)),
  }
}

const expected = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'expected.json'), 'utf8'))

for (const [name, want] of Object.entries(expected)) {
  test(`reads ${name} unchanged`, async () => {
    assert.deepEqual(await summarize(name), want)
  })
}
