import { test } from 'node:test'
import assert from 'node:assert/strict'
import { intersectRanges } from '../src/filter.js'

const size = 8

/** Maximal runs of set bits as half-open [start, end) ranges. */
function runs(mask) {
  const out = []
  for (let i = 0; i < size; i++) {
    if (!(mask >> i & 1)) continue
    const last = out[out.length - 1]
    if (last && last[1] === i) last[1] = i + 1
    else out.push([i, i + 1])
  }
  return out
}

test('intersection of sorted disjoint ranges matches the cell-by-cell result', () => {
  for (let a = 0; a < 1 << size; a++) {
    for (let b = 0; b < 1 << size; b++) {
      assert.deepEqual(intersectRanges(runs(a), runs(b)), runs(a & b), `masks ${a} and ${b}`)
    }
  }
})

test('ranges that end on the same row', () => {
  assert.deepEqual(intersectRanges([[0, 5], [8, 10]], [[2, 5], [9, 10]]), [[2, 5], [9, 10]])
  assert.deepEqual(intersectRanges([[0, 4], [4, 9]], [[1, 4], [4, 6]]), [[1, 4], [4, 6]])
})

test('undefined stands for every row', () => {
  assert.deepEqual(intersectRanges(undefined, [[1, 2]]), [[1, 2]])
  assert.deepEqual(intersectRanges([[1, 2]], undefined), [[1, 2]])
  assert.equal(intersectRanges(undefined, undefined), undefined)
})
