import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wkbToGeojson } from '../src/wkb.js'

function point(rawType, coordinates) {
  const bytes = new Uint8Array(5 + coordinates.length * 8)
  const view = new DataView(bytes.buffer)
  bytes[0] = 1
  view.setUint32(1, rawType, true)
  coordinates.forEach((c, i) => view.setFloat64(5 + i * 8, c, true))
  return { view, offset: 0 }
}

test('every ISO coordinate layout of a point keeps its dimensions', () => {
  assert.deepEqual(wkbToGeojson(point(1, [1, 2])).coordinates, [1, 2])
  assert.deepEqual(wkbToGeojson(point(1001, [1, 2, 3])).coordinates, [1, 2, 3])
  assert.deepEqual(wkbToGeojson(point(2001, [1, 2, 4])).coordinates, [1, 2, 4])
  assert.deepEqual(wkbToGeojson(point(3001, [1, 2, 3, 4])).coordinates, [1, 2, 3, 4])
})
