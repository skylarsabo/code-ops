# scale-prolog review claims, second set
Each line claims a defect at one site in `repo/`, and some of these claims are wrong.

- H-01 · modules/core.js:6419 · The duplicate test on this line matches two numbers by value alone, so sort([1, 1.0], L) drops one of them and binds L to a list of one element instead of [1.0, 1].
- H-02 · modules/core.js:5641 · The branch on this line drops a ball that the catcher does not match, so catch(catch(throw(a), b, true), E, true) fails instead of letting the outer catch bind E to a.
- H-03 · modules/lists.js:121 · The rule on this line folds from the head of the list instead of from the tail, so foldr(atom_concat, [a,b,c], '', R) binds R to cba instead of abc.
- H-04 · modules/lists.js:186 · The rule on this line passes the parts to append in the wrong order, so prefix(P, [a,b]) yields the suffixes [a,b], [b], and [] instead of the prefixes [], [a], and [a,b].
- H-05 · modules/core.js:4770 · The default on this line turns the occurs check on for every new session, so the unification X = f(X) fails instead of succeeding as it does when the flag starts as false.
- H-06 · modules/core.js:7131 · The text on this line comes from a number conversion that drops a zero fraction, so number_chars(2.0, L) binds L to ['2'] instead of ['2', '.', '0'] and loses the float type.
- H-07 · modules/core.js:6829 · The count on this line measures UTF-16 code units, so atom_length on an atom that holds the one emoji character with code 128512 binds N to 2 instead of 1.
- H-08 · modules/core.js:7293 · The conversion on this line reads a field that numbers do not carry, so atomic_list_concat([a, 1], X) binds X to the atom aundefined instead of the atom a1.
- H-09 · modules/core.js:4315 · The product on this line is returned as it is, so X is 9007199254740991 * 4 binds X to an inexact large integer instead of raising the evaluation error int_overflow.
- H-10 · modules/lists.js:403 · The inner loop on this line keeps going after a match and keeps only the last comparison, so list_to_set([a,b,a], S) binds S to [a,b,a] instead of [a,b].
- H-11 · modules/os.js:748 · The call getenv('NO_SUCH_VAR', 42) fails instead of raising a type error, because the value test on this line lets a number through to the lookup of the variable.
- H-12 · modules/core.js:3316 · This method returns no value when an integer meets a float of the same value, so 1 @> 1.0 fails instead of succeeding, though a float comes before an integer in the standard order.
- H-13 · modules/core.js:6448 · The branch on this line has no error for an element that is not a pair, so keysort([a], L) fails instead of raising the type error pair for the element a.
- H-14 · modules/core.js:6011 · The copy on this line gives each variable occurrence its own fresh variable, so after copy_term(f(X, X), C) and C = f(a, Y) the variable Y stays unbound instead of being a.
- H-15 · modules/core.js:7119 · The parse on this line reads only decimal digits, so number_chars(X, ['0', x, f, f]) raises a syntax error instead of binding X to 255 for the hexadecimal text 0xff.
- H-16 · modules/core.js:5905 · The goal on this line hands the work to the bag collector, so setof(X, member(X, [b,a,b]), L) binds L to [b,a,b] instead of the sorted set [a,b].
- H-17 · modules/core.js:7069 · The code on this line comes from the first UTF-16 unit of the atom, so char_code on the emoji character with code 128512 binds the code to the surrogate 55357 instead of 128512.
- H-18 · modules/js.js:54 · The catch block on this line reports success when the called function throws, so apply on JSON.parse with the text '{' succeeds with R unbound instead of raising a JavaScript error.
- H-19 · modules/core.js:4340 · The power on this line returns a fraction for two integers, so X is 2 ^ (-1) binds X to 0.5 instead of raising an error for a result that is not an integer.
- H-20 · modules/core.js:6894 · The domain test on this line rejects an after count of zero, so sub_atom(abc, B, 1, 0, S) raises a domain error instead of binding S to c and B to 2.
