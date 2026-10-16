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

test('map values keep falsy entries and turn an absent value into null', () => {
  const subcolumns = new Map([
    ['m.key_value.key', [['a', 'b', 'c', 'd', 'e']]],
    ['m.key_value.value', [[undefined, null, 0, '', false]]],
  ])
  assembleNested(subcolumns, mapSchema, {})
  assert.deepEqual(subcolumns.get('m'), [{ a: null, b: null, c: 0, d: '', e: false }])
})
