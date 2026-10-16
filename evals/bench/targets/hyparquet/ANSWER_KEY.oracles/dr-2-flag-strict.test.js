import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parquetQuery } from '../src/index.js'
import { checkOrderOptions } from '../src/order.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** @param {string} name */
function load(name) {
  const buf = readFileSync(join(dataDir, name + '.parquet'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test('checkOrderOptions accepts consistent options', () => {
  for (const options of [{}, { orderBy: 'x' }, { orderBy: 'x', descending: true }, { orderBy: 'x', nullsFirst: true },
    { orderBy: 'x', descending: false, nullsFirst: true }, { descending: false }, { nullsFirst: false, descending: false }]) {
    assert.doesNotThrow(() => checkOrderOptions(options), JSON.stringify(options))
  }
})

test('checkOrderOptions rejects flags that cannot apply', () => {
  assert.throws(() => checkOrderOptions({ descending: true }), /require orderBy/)
  assert.throws(() => checkOrderOptions({ nullsFirst: true }), /require orderBy/)
  assert.throws(() => checkOrderOptions({ orderBy: '', descending: true }), /require orderBy/)
  for (const bad of [1, 0, 'yes', '', null, {}]) {
    assert.throws(() => checkOrderOptions({ orderBy: 'x', descending: bad }), /descending must be a boolean/)
    assert.throws(() => checkOrderOptions({ orderBy: 'x', nullsFirst: bad }), /nullsFirst must be a boolean/)
    assert.throws(() => checkOrderOptions({ descending: bad }), /must be a boolean/)
  }
})

test('parquetQuery rejects a flag without orderBy', async () => {
  const file = load('dictionary_offset_indexed')
  await assert.rejects(parquetQuery({ file, descending: true }), /require orderBy/)
  await assert.rejects(parquetQuery({ file, orderBy: 'id', nullsFirst: 1 }), /boolean/)
  assert.equal((await parquetQuery({ file, orderBy: 'id', descending: true })).length, 200)
})
