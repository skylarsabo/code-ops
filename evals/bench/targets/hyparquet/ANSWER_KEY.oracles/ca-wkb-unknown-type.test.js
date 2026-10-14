import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wkbToGeojson } from '../src/wkb.js'

function header(type) {
  const bytes = new Uint8Array(5)
  bytes[0] = 1
  new DataView(bytes.buffer).setUint32(1, type, true)
  return bytes
}

function reader(bytes) {
  return { view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 }
}

test('a geometry type the decoder does not know is refused', () => {
  assert.throws(() => wkbToGeojson(reader(header(8))), /Unsupported geometry type: 8/)
  assert.throws(() => wkbToGeojson(reader(header(0))), /Unsupported geometry type: 0/)
})

test('a point is decoded', () => {
  const bytes = new Uint8Array(21)
  const view = new DataView(bytes.buffer)
  bytes[0] = 1
  view.setUint32(1, 1, true)
  view.setFloat64(5, 1.5, true)
  view.setFloat64(13, -2.5, true)
  assert.deepEqual(wkbToGeojson(reader(bytes)), { type: 'Point', coordinates: [1.5, -2.5] })
})
