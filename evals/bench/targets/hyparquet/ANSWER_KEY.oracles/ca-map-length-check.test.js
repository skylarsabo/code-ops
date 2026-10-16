import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleNested } from '../src/assemble.js'

const leaf = (name, repetition_type) => ({
  element: { name, repetition_type },
  path: ['m', 'key_value', name],
  children: [],
})

const mapSchema = {
  element: { name: 'm', repetition_type: 'REQUIRED', converted_type: 'MAP' },
  path: ['m'],
  children: [{
    element: { name: 'key_value', repetition_type: 'REPEATED' },
    path: ['m', 'key_value'],
    children: [leaf('key', 'REQUIRED'), leaf('value', 'OPTIONAL')],
  }],
}

function assemble(keys, values) {
  const subcolumns = new Map([['m.key_value.key', keys], ['m.key_value.value', values]])
  assembleNested(subcolumns, mapSchema, {})
  return subcolumns.get('m')
}

test('key and value columns of different lengths are refused', () => {
  assert.throws(() => assemble([['a']], [['x'], ['y']]), /key\/value length mismatch/)
  assert.throws(() => assemble([['a'], ['b']], [['x']]), /key\/value length mismatch/)
})

test('matching key and value columns assemble into maps', () => {
  assert.deepEqual(assemble([['a', 'b'], []], [[1, 2], []]), [{ a: 1, b: 2 }, {}])
})
