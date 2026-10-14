import { test } from 'node:test'
import assert from 'node:assert/strict'
import { intersectRanges } from '../src/filter.js'

let state = 20260501
function next(limit) {
  state = (Math.imul(state, 1103515245) + 12345) >>> 0
  return (state >>> 16) % limit
}

function randomRanges(span) {
  const out = []
  let at = next(3)
  while (at < span) {
    const start = at + next(4)
    const end = start + 1 + next(5)
    if (end > span) break
    out.push([start, end])
    at = end + next(3)
  }
  return out
}

const covers = (ranges, point) => ranges.some(([start, end]) => point >= start && point < end)

test('intersection matches a pointwise check, including ranges that end together', () => {
  assert.deepEqual(intersectRanges([[0, 5], [8, 10]], [[3, 5], [9, 12]]), [[3, 5], [9, 10]])
  assert.deepEqual(intersectRanges([[0, 4], [4, 9]], [[0, 9]]), [[0, 4], [4, 9]])
  for (let trial = 0; trial < 400; trial++) {
    const a = randomRanges(40)
    const b = randomRanges(40)
    const result = intersectRanges(a, b)
    for (let point = 0; point < 45; point++) {
      assert.equal(covers(result, point), covers(a, point) && covers(b, point), `trial ${trial} point ${point}`)
    }
    for (let i = 1; i < result.length; i++) assert.ok(result[i - 1][1] <= result[i][0])
  }
})

test('an undefined side means everything', () => {
  assert.deepEqual(intersectRanges(undefined, [[1, 2]]), [[1, 2]])
  assert.deepEqual(intersectRanges([[1, 2]], undefined), [[1, 2]])
  assert.equal(intersectRanges(undefined, undefined), undefined)
})
