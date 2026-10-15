// Acceptance test: the pl.create options object (limit and flags) and library(pairs).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/lists.js')(pl)
require('../modules/pairs.js')(pl)

const PRELUDE = ':- use_module(library(lists)).\n:- use_module(library(pairs)).\n'

/** Run a query to exhaustion in a session made by pl.create(options); return the formatted answers. */
async function ask(goal, options, program = '') {
  const session = pl.create(options)
  await new Promise((resolve) => session.consult(PRELUDE + program, { success: resolve, error: resolve }))
  const parseError = await new Promise((resolve) => session.query(goal, { success: () => resolve(null), error: resolve }))
  if (parseError !== null) return [pl.format_answer(parseError)]
  const out = []
  for (let i = 0; i < 20; i++) {
    const next = await new Promise((resolve) => session.answer({
      success: (a) => resolve(pl.format_answer(a)),
      fail: () => resolve(null),
      error: (e) => resolve(pl.format_answer(e)),
      limit: () => resolve('LIMIT')
    }))
    if (next === null) break
    out.push(next)
    if (next === 'LIMIT') break
  }
  return out
}

const raised = (goal) => ask(`catch((${goal}), error(E, _), true).`)
/** True when the query has exactly one answer. */
const holds = async (goal) => (await ask(goal)).length === 1
const flagOf = async (name, options) => (await ask(`current_prolog_flag(${name}, X).`, options))[0]

const DEFAULT_QUOTES = 'X = chars'

test('the number form of pl.create still sets the inference limit', async () => {
  assert.deepEqual(await ask('p.', 50, 'p :- p.'), ['LIMIT'])
  assert.deepEqual(await ask('member(X, [a]).', 50), ['X = a'])
  assert.deepEqual(await ask('member(X, [a]).'), ['X = a'])
})

test('the options object accepts a limit', async () => {
  assert.deepEqual(await ask('p.', { limit: 50 }, 'p :- p.'), ['LIMIT'])
  assert.deepEqual(await ask('member(X, [a, b]).', { limit: 5000 }), ['X = a', 'X = b'])
})

test('a limit that is not a positive number means no limit', async () => {
  for (const limit of [0, -1, 'x', null, undefined, NaN]) {
    assert.deepEqual(await ask('findall(X, member(X, [a,b]), L).', { limit }), ['L = [a,b]'], String(limit))
  }
})

test('empty, null and undefined options behave like no options', async () => {
  for (const options of [undefined, null, {}, { flags: undefined }, { flags: null }, { flags: {} }]) {
    assert.equal(await flagOf('double_quotes', options), DEFAULT_QUOTES)
  }
})

test('the double_quotes flag changes how the parser reads a string', async () => {
  assert.deepEqual(await ask('X = "ab".'), ['X = [a,b]'])
  assert.deepEqual(await ask('X = "ab".', { flags: { double_quotes: 'atom' } }), ['X = ab'])
  assert.deepEqual(await ask('X = "ab".', { flags: { double_quotes: 'codes' } }), ['X = [97,98]'])
  assert.deepEqual(await ask('X = "ab".', { flags: { double_quotes: 'chars' } }), ['X = [a,b]'])
})

test('the unknown flag changes how an undefined predicate is handled', async () => {
  assert.deepEqual(await ask('foo(1).', { flags: { unknown: 'fail' } }), [])
  const [answer] = await ask('foo(1).')
  assert.ok(answer.startsWith('uncaught exception: error(existence_error(procedure'), answer)
})

test('current_prolog_flag shows the session flags', async () => {
  const options = { flags: { double_quotes: 'atom', unknown: 'fail' } }
  assert.equal(await flagOf('double_quotes', options), 'X = atom')
  assert.equal(await flagOf('unknown', options), 'X = fail')
  assert.equal(await flagOf('unknown'), 'X = error')
})

test('flags and limit work together', async () => {
  const options = { limit: 50, flags: { double_quotes: 'atom' } }
  assert.deepEqual(await ask('X = "ab".', options), ['X = ab'])
  assert.deepEqual(await ask('p.', options, 'p :- p.'), ['LIMIT'])
})

test('flags stay in their own session', async () => {
  const first = pl.create({ flags: { double_quotes: 'atom' } })
  const second = pl.create()
  assert.equal(first.get_flag('double_quotes').id, 'atom')
  assert.equal(second.get_flag('double_quotes').id, 'chars')
  assert.equal(pl.flag.double_quotes.value.id, 'chars')
  assert.equal(await flagOf('double_quotes'), DEFAULT_QUOTES)
  await ask('set_prolog_flag(double_quotes, codes).', { flags: { double_quotes: 'atom' } })
  assert.equal(await flagOf('double_quotes'), DEFAULT_QUOTES)
})

test('a failed pl.create changes nothing for later sessions', async () => {
  assert.throws(() => pl.create({ flags: { double_quotes: 'atom', bounded: 'false' } }), Error)
  assert.equal(pl.flag.double_quotes.value.id, 'chars')
  assert.equal(await flagOf('double_quotes'), DEFAULT_QUOTES)
})

test('pl.create throws an Error that names the flag', () => {
  const named = (flags, name) => assert.throws(() => pl.create({ flags }), (e) => e instanceof Error && e.message.includes(name), name)
  named({ bounded: 'false' }, 'bounded')
  named({ max_arity: 'unbounded' }, 'max_arity')
  named({ no_such_flag: 'on' }, 'no_such_flag')
  named({ double_quotes: 'bogus' }, 'double_quotes')
  named({ double_quotes: 3 }, 'double_quotes')
  named({ unknown: null }, 'unknown')
  named({ unknown: ['fail'] }, 'unknown')
  named({ toString: 'x' }, 'toString')
  named({ double_quotes: 'atom', debug: 'maybe' }, 'debug')
})

test('pl.create throws an Error when flags is not an object', () => {
  for (const flags of [[], ['double_quotes'], 'double_quotes', 3, true]) {
    assert.throws(() => pl.create({ flags }), Error, JSON.stringify(flags))
  }
})

test('pairs_keys_values splits and joins pairs', async () => {
  assert.ok(await holds('pairs_keys_values([a-1, b-2, c-3], K, V), K == [a,b,c], V == [1,2,3].'))
  assert.ok(await holds('pairs_keys_values([], K, V), K == [], V == [].'))
  assert.ok(await holds('pairs_keys_values(P, [a,b], [1,2]), P == [a-1, b-2].'))
  assert.ok(await holds('pairs_keys_values(P, [], []), P == [].'))
  assert.ok(await holds('pairs_keys_values([a-1, b-2], [a,b], [1,2]).'))
  assert.ok(await holds('pairs_keys_values([a-X, b-Y], K, [1,2]), X == 1, Y == 2, K == [a,b].'))
  assert.deepEqual(await ask('pairs_keys_values([a-1, b-2], [a,z], V).'), [])
  assert.deepEqual(await ask('pairs_keys_values([a-1, b-2], K, [1,3]).'), [])
})

test('pairs_keys_values builds pairs only from two proper lists of one length', async () => {
  assert.deepEqual(await ask('pairs_keys_values(P, [a], [1,2]).'), [])
  assert.deepEqual(await ask('pairs_keys_values(P, [a,b], [1]).'), [])
  assert.deepEqual(await raised('pairs_keys_values(P, [a], V)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('pairs_keys_values(P, K, [1])'), ['E = instantiation_error'])
  assert.deepEqual(await raised('pairs_keys_values(P, [a|T], [1])'), ['E = instantiation_error'])
})

test('pairs_keys and pairs_values read one side', async () => {
  assert.ok(await holds('pairs_keys([a-1, b-2, a-3], K), K == [a,b,a].'))
  assert.ok(await holds('pairs_values([a-1, b-2, a-3], V), V == [1,2,3].'))
  assert.ok(await holds('pairs_keys([], K), K == [].'))
  assert.ok(await holds('pairs_values([], V), V == [].'))
  assert.ok(await holds('pairs_values([a-f(X), b-g(X)], [f(1), g(Y)]), X == 1, Y == 1.'))
  assert.deepEqual(await ask('pairs_keys([a-1, b-2], [a]).'), [])
  assert.deepEqual(await ask('pairs_values([a-1, b-2], [1,2,3]).'), [])
})

test('transpose_pairs swaps and sorts by the new key, keeping equal keys in order', async () => {
  assert.ok(await holds('transpose_pairs([a-2, b-1, c-2], T), T == [1-b, 2-a, 2-c].'))
  assert.ok(await holds('transpose_pairs([x-b, y-a, z-b, w-a], T), T == [a-y, a-w, b-x, b-z].'))
  assert.ok(await holds('transpose_pairs([a-1, a-1], T), T == [1-a, 1-a].'))
  assert.ok(await holds('transpose_pairs([], T), T == [].'))
  assert.ok(await holds('transpose_pairs([a-f(x), b-3, c-z], T), T == [3-b, z-c, f(x)-a].'))
  assert.ok(await holds('numlist(1, 30, N), findall(K-V, (member(K, N), V is 7 - K mod 7), Ps), transpose_pairs(Ps, T), T = [F|_], F == 1-6.'))
  assert.deepEqual(await ask('transpose_pairs([a-2, b-1], [2-a, 1-b]).'), [])
})

test('group_pairs_by_key groups adjacent identical keys', async () => {
  assert.ok(await holds('group_pairs_by_key([a-1, a-2, b-3, a-4], G), G == [a-[1,2], b-[3], a-[4]].'))
  assert.ok(await holds('group_pairs_by_key([a-1], G), G == [a-[1]].'))
  assert.ok(await holds('group_pairs_by_key([], G), G == [].'))
  assert.ok(await holds('group_pairs_by_key([a-1, b-1, c-1], G), G == [a-[1], b-[1], c-[1]].'))
  assert.ok(await holds('group_pairs_by_key([f(x)-1, f(x)-2, f(y)-3], G), G == [f(x)-[1,2], f(y)-[3]].'))
  assert.ok(await holds('group_pairs_by_key([1-a, 1.0-b, 1-c], G), G == [1-[a], 1.0-[b], 1-[c]].'))
  assert.ok(await holds('group_pairs_by_key([a-1, a-1], G), G == [a-[1,1]].'))
  assert.ok(await holds('keysort([b-1, a-2, b-3, a-4], S), group_pairs_by_key(S, G), G == [a-[2,4], b-[1,3]].'))
})

test('group_pairs_by_key treats distinct variables as distinct keys', async () => {
  assert.ok(await holds('group_pairs_by_key([A-1, A-2, B-3], G), G = [K1-V1, K2-V2], K1 == A, V1 == [1,2], K2 == B, V2 == [3].'))
})

test('pairs predicates reject bad pair lists', async () => {
  for (const name of ['pairs_keys(%, X)', 'pairs_values(%, X)', 'transpose_pairs(%, X)', 'group_pairs_by_key(%, X)', 'pairs_keys_values(%, K, V)']) {
    const goal = (list) => name.replace('%', list)
    assert.deepEqual(await raised(goal('[a-1, b]')), ['E = type_error(pair,b)'], goal('[a-1, b]'))
    assert.deepEqual(await raised(goal('[a-1, 3]')), ['E = type_error(pair,3)'], goal('[a-1, 3]'))
    assert.deepEqual(await raised(goal('[a-1, b|c]')), ['E = type_error(pair,b)'], goal('[a-1, b|c]'))
    assert.deepEqual(await raised(goal('[a-1, _]')), ['E = instantiation_error'], goal('[a-1, _]'))
    assert.deepEqual(await raised(goal('[a-1|_]')), ['E = instantiation_error'], goal('[a-1|_]'))
    assert.deepEqual(await raised(goal('foo')), ['E = type_error(list,foo)'], goal('foo'))
    assert.deepEqual(await raised(goal('[a-1|c]')), ['E = type_error(list,[-(a,1)|c])'], goal('[a-1|c]'))
  }
  for (const name of ['pairs_keys(%, X)', 'pairs_values(%, X)', 'transpose_pairs(%, X)', 'group_pairs_by_key(%, X)']) {
    assert.deepEqual(await raised(name.replace('%', '_')), ['E = instantiation_error'], name)
  }
})
