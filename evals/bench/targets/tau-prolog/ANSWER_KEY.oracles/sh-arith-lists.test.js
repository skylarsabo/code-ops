// Acceptance test: lcm/2, msb/1 and cot/1 evaluables, divmod/4, and the numlist/3,
// max_member/2, min_member/2 and lcm_list/2 list predicates.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const pl = require('../modules/core.js')
require('../modules/lists.js')(pl)

/** Run a query to exhaustion in a fresh session; return the formatted answers (none means it failed). */
async function ask(goal) {
  const session = pl.create()
  await new Promise((resolve) => session.consult(':- use_module(library(lists)).', { success: resolve, error: resolve }))
  const parseError = await new Promise((resolve) => session.query(goal, { success: () => resolve(null), error: resolve }))
  if (parseError !== null) return [pl.format_answer(parseError)]
  const out = []
  for (let i = 0; i < 20; i++) {
    const next = await new Promise((resolve) => session.answer({
      success: (a) => resolve(pl.format_answer(a)),
      fail: () => resolve(null),
      error: (e) => resolve(pl.format_answer(e)),
      limit: () => resolve(null)
    }))
    if (next === null) break
    out.push(next)
  }
  return out
}

/** The formal part E of an error(E, _) raised by the goal, as one formatted answer. */
const raised = (goal) => ask(`catch((${goal}), error(E, _), true).`)
const value = async (expr) => (await ask(`X is ${expr}.`))[0]

test('lcm of positive integers', async () => {
  assert.equal(await value('lcm(4, 6)'), 'X = 12')
  assert.equal(await value('lcm(7, 7)'), 'X = 7')
  assert.equal(await value('lcm(3, 5)'), 'X = 15')
  assert.deepEqual(await ask('lcm(4, 6) =:= 12.'), ['true'])
  assert.equal(await value('lcm(2, 3) + lcm(4, 6)'), 'X = 18')
})

test('lcm is never negative and is 0 when an argument is 0', async () => {
  assert.equal(await value('lcm(-4, 6)'), 'X = 12')
  assert.equal(await value('lcm(4, -6)'), 'X = 12')
  assert.equal(await value('lcm(-4, -6)'), 'X = 12')
  assert.equal(await value('lcm(0, 5)'), 'X = 0')
  assert.equal(await value('lcm(5, 0)'), 'X = 0')
  assert.equal(await value('lcm(0, 0)'), 'X = 0')
  assert.equal(await value('lcm(0, -5)'), 'X = 0')
})

test('lcm rejects floats and unbound arguments', async () => {
  assert.deepEqual(await raised('X is lcm(2.0, 3)'), ['E = type_error(integer,2.0)'])
  assert.deepEqual(await raised('X is lcm(3, 2.5)'), ['E = type_error(integer,2.5)'])
  assert.deepEqual(await raised('X is lcm(_, 3)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('X is lcm(3, _)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('X is msb(_)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('X is cot(_)'), ['E = instantiation_error'])
})

test('msb gives the index of the highest set bit', async () => {
  assert.equal(await value('msb(1)'), 'X = 0')
  assert.equal(await value('msb(2)'), 'X = 1')
  assert.equal(await value('msb(3)'), 'X = 1')
  assert.equal(await value('msb(1023)'), 'X = 9')
  assert.equal(await value('msb(1024)'), 'X = 10')
  assert.equal(await value('msb(1099511627775)'), 'X = 39')
  assert.equal(await value('msb(1099511627776)'), 'X = 40')
  assert.deepEqual(await ask('X is msb(1024), integer(X).'), ['X = 10'])
})

test('msb rejects values below 1 and floats', async () => {
  assert.deepEqual(await raised('X is msb(0)'), ['E = evaluation_error(undefined)'])
  assert.deepEqual(await raised('X is msb(-3)'), ['E = evaluation_error(undefined)'])
  assert.deepEqual(await raised('X is msb(2.0)'), ['E = type_error(integer,2.0)'])
})

test('cot is a float cotangent', async () => {
  const [answer] = await ask('X is cot(1), float(X), Y is abs(X - 0.6420926159343306), Y < 1.0e-12.')
  assert.ok(answer && answer.startsWith('X = 0.642092615934'), answer)
  const [negative] = await ask('X is cot(-1), X < -0.64, X > -0.65.')
  assert.ok(negative && negative.startsWith('X = -0.642092615934'), negative)
  const [second] = await ask('X is cot(2), X < -0.457, X > -0.458.')
  assert.ok(second && second.startsWith('X = -0.4576575543'), second)
  assert.deepEqual(await ask('cot(1) > 0.64.'), ['true'])
})

test('cot of zero raises a zero divisor error', async () => {
  assert.deepEqual(await raised('X is cot(0)'), ['E = evaluation_error(zero_divisor)'])
  assert.deepEqual(await raised('X is cot(0.0)'), ['E = evaluation_error(zero_divisor)'])
})

test('divmod floors the quotient and gives the remainder the sign of the divisor', async () => {
  const cases = [[7, 2, 3, 1], [-7, 2, -4, 1], [7, -2, -4, -1], [-7, -2, 3, -1], [6, 3, 2, 0], [0, 5, 0, 0], [3, 7, 0, 3], [-1, 5, -1, 4]]
  for (const [a, b, q, r] of cases) {
    assert.deepEqual(await ask(`divmod(${a}, ${b}, Q, R).`), [`Q = ${q}, R = ${r}`], `divmod(${a}, ${b})`)
  }
})

test('divmod unifies bound outputs', async () => {
  assert.deepEqual(await ask('divmod(7, 2, 3, 1).'), ['true'])
  assert.deepEqual(await ask('divmod(7, 2, 3, 0).'), [])
  assert.deepEqual(await ask('divmod(7, 2, 4, R).'), [])
  assert.deepEqual(await ask('divmod(-7, 2, Q, 1).'), ['Q = -4'])
  assert.deepEqual(await ask('divmod(-7, 2, Q, 0).'), [])
})

test('divmod checks its arguments in order', async () => {
  assert.deepEqual(await raised('divmod(7, 0, Q, R)'), ['E = evaluation_error(zero_divisor)'])
  assert.deepEqual(await raised('divmod(0, 0, Q, R)'), ['E = evaluation_error(zero_divisor)'])
  assert.deepEqual(await raised('divmod(_, 2, Q, R)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('divmod(7, _, Q, R)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('divmod(_, 0, Q, R)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('divmod(7.0, 2, Q, R)'), ['E = type_error(integer,7.0)'])
  assert.deepEqual(await raised('divmod(7, 2.0, Q, R)'), ['E = type_error(integer,2.0)'])
  assert.deepEqual(await raised('divmod(a, b, Q, R)'), ['E = type_error(integer,a)'])
  assert.deepEqual(await raised('divmod(7.0, 0, Q, R)'), ['E = type_error(integer,7.0)'])
})

test('numlist builds an ascending list of integers', async () => {
  assert.deepEqual(await ask('numlist(1, 5, L).'), ['L = [1,2,3,4,5]'])
  assert.deepEqual(await ask('numlist(3, 3, L).'), ['L = [3]'])
  assert.deepEqual(await ask('numlist(-2, 2, L).'), ['L = [-2,-1,0,1,2]'])
  assert.deepEqual(await ask('numlist(5, 1, L).'), [])
  assert.deepEqual(await ask('numlist(1, 3, [1,2,3]).'), ['true'])
  assert.deepEqual(await ask('numlist(1, 3, [1,2]).'), [])
  assert.deepEqual(await ask('numlist(1, 3, [A|T]).'), ['A = 1, T = [2,3]'])
})

test('numlist checks instantiation before types, then Low before High', async () => {
  assert.deepEqual(await raised('numlist(_, 3, L)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('numlist(1, _, L)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('numlist(_, a, L)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('numlist(a, 3, L)'), ['E = type_error(integer,a)'])
  assert.deepEqual(await raised('numlist(1, 2.0, L)'), ['E = type_error(integer,2.0)'])
  assert.deepEqual(await raised('numlist(2.0, a, L)'), ['E = type_error(integer,2.0)'])
})

test('max_member and min_member use the standard order of terms', async () => {
  assert.deepEqual(await ask('max_member(M, [3, 1, 2]).'), ['M = 3'])
  assert.deepEqual(await ask('min_member(M, [3, 1, 2]).'), ['M = 1'])
  assert.deepEqual(await ask('max_member(M, [b, c, a]).'), ['M = c'])
  assert.deepEqual(await ask('min_member(M, [b, c, a]).'), ['M = a'])
  assert.deepEqual(await ask('max_member(M, [f(a), f(c), f(b)]).'), ['M = f(c)'])
  assert.deepEqual(await ask('max_member(M, [a, 3, f(x), b]).'), ['M = f(x)'])
  assert.deepEqual(await ask('min_member(M, [b, 3, a, f(x)]).'), ['M = 3'])
  assert.deepEqual(await ask('max_member(M, [x]).'), ['M = x'])
  assert.deepEqual(await ask('min_member(M, [x]).'), ['M = x'])
  const mixed = await ask('L = [foo(1), 2.5, zed, 10, bar(1,2), a], msort(L, S), last(S, W), max_member(M, L), M == W.')
  assert.equal(mixed.length, 1)
  assert.ok(mixed[0].endsWith('M = bar(1,2)'), mixed[0])
})

test('max_member and min_member give one answer and test the extreme', async () => {
  assert.deepEqual(await ask('max_member(M, [c, c, c]).'), ['M = c'])
  assert.deepEqual(await ask('min_member(M, [a, b, a]).'), ['M = a'])
  assert.deepEqual(await ask('max_member(c, [a, b, c]).'), ['true'])
  assert.deepEqual(await ask('max_member(b, [a, b, c]).'), [])
  assert.deepEqual(await ask('min_member(a, [a, b, c]).'), ['true'])
  assert.deepEqual(await ask('min_member(b, [a, b, c]).'), [])
  assert.deepEqual(await ask('max_member(M, []).'), [])
  assert.deepEqual(await ask('min_member(M, []).'), [])
})

test('max_member and min_member reject partial and non-lists', async () => {
  assert.deepEqual(await raised('max_member(M, _)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('min_member(M, _)'), ['E = instantiation_error'])
  assert.deepEqual(await raised('max_member(M, [a|_])'), ['E = instantiation_error'])
  assert.deepEqual(await raised('min_member(M, [a|_])'), ['E = instantiation_error'])
  assert.deepEqual(await raised('max_member(M, foo)'), ['E = type_error(list,foo)'])
  assert.deepEqual(await raised('min_member(M, foo)'), ['E = type_error(list,foo)'])
  assert.deepEqual(await raised('max_member(M, [a|b])'), ['E = type_error(list,[a|b])'])
})

test('lcm_list combines a list with lcm', async () => {
  assert.deepEqual(await ask('lcm_list([], L).'), ['L = 1'])
  assert.deepEqual(await ask('lcm_list([5], L).'), ['L = 5'])
  assert.deepEqual(await ask('lcm_list([4, 6, 10], L).'), ['L = 60'])
  assert.deepEqual(await ask('lcm_list([-4, 6], L).'), ['L = 12'])
  assert.deepEqual(await ask('lcm_list([0, 3], L).'), ['L = 0'])
  assert.deepEqual(await ask('lcm_list([2, 3], 6).'), ['true'])
  assert.deepEqual(await ask('lcm_list([2, 3], 5).'), [])
  assert.deepEqual(await ask('numlist(1, 10, N), lcm_list(N, L).'), ['N = [1,2,3,4,5,6,7,8,9,10], L = 2520'])
})

test('lcm_list raises the lcm errors', async () => {
  assert.deepEqual(await raised('lcm_list([3, 2.0], L)'), ['E = type_error(integer,2.0)'])
  assert.deepEqual(await raised('lcm_list([2.5], L)'), ['E = type_error(integer,2.5)'])
  assert.deepEqual(await raised('lcm_list([_, 3], L)'), ['E = instantiation_error'])
})
