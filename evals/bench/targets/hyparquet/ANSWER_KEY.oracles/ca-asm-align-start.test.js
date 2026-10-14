import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleAsync } from '../src/rowgroup.js'

const leaf = name => ({
  element: { name, repetition_type: 'REQUIRED' },
  path: ['s', name],
  children: [],
})

const schemaTree = {
  element: { name: 'root' },
  path: [],
  children: [{
    element: { name: 's', repetition_type: 'REQUIRED' },
    path: ['s'],
    children: [leaf('a'), leaf('b')],
  }],
}

test('physical children read from different page boundaries line up on absolute rows', async () => {
  const group = {
    groupStart: 0,
    groupRows: 4,
    selectStart: 2,
    selectEnd: 4,
    asyncColumns: [
      // read from the first page: rows 0 to 3
      { pathInSchema: ['s', 'a'], data: Promise.resolve({ data: [[10, 11, 12, 13]], skipped: 0 }) },
      // read from the second page only: rows 2 and 3
      { pathInSchema: ['s', 'b'], data: Promise.resolve({ data: [[22, 23]], skipped: 2 }) },
    ],
  }
  const assembled = assembleAsync(group, schemaTree)
  assert.equal(assembled.asyncColumns.length, 1)
  const { data, skipped } = await assembled.asyncColumns[0].data
  assert.equal(skipped, 2)
  assert.deepEqual(data, [[{ a: 12, b: 22 }, { a: 13, b: 23 }]])
})

test('children that start on the same row need no realignment', async () => {
  const group = {
    groupStart: 0,
    groupRows: 3,
    selectStart: 0,
    selectEnd: 3,
    asyncColumns: [
      { pathInSchema: ['s', 'a'], data: Promise.resolve({ data: [[1, 2, 3]], skipped: 0 }) },
      { pathInSchema: ['s', 'b'], data: Promise.resolve({ data: [[4, 5, 6]], skipped: 0 }) },
    ],
  }
  const { data } = await assembleAsync(group, schemaTree).asyncColumns[0].data
  assert.deepEqual(data, [[{ a: 1, b: 4 }, { a: 2, b: 5 }, { a: 3, b: 6 }]])
})
