# scale-prolog: answer key

A Prolog interpreter (`repo/`, about 12,100 source lines, one file of about 9,100) with **38 planted defects** and **15 decoys**, derived by `build.mjs` from the bench target and its bug-hunt and codebase-audit seeds. Each defect fails a hidden oracle; each decoy is an equivalent rewrite whose oracle passes. Do not hand-edit: run `node evals/scale-prolog/build.mjs`.

Keep this file, `ANSWER_KEY.json`, `build.mjs`, and `evals/bench/` out of any context you give the skill: the bench target is the unseeded source, so a diff against it reveals every seed.

Pass bar: recall at least 50% and at most 0 decoy flagged, matched within 3 lines.

## Planted defects (should be found)
| ID | Location | Category | What changed |
|----|----------|----------|--------------|
| bh-succ-zero | `modules/core.js:7408` | off-by-one | `if( pl.type.is_variable( m ) \|\| m.value > 0 ) {` became `if( pl.type.is_variable( m ) \|\| m.value >= 0 ) {` |
| bh-arg-last | `modules/core.js:5956` | off-by-one | `if( n > 0 && n <= atom.args[1].args.length ) {` became `if( n > 0 && n < atom.args[1].args.length ) {` |
| bh-subatom-after-zero | `modules/core.js:6894` | off-by-one | `pl.type.is_integer( after ) && after.value < 0 ) {` became `pl.type.is_integer( after ) && after.value <= 0 ) {` |
| bh-rem-zero | `modules/core.js:4370` | missing-guard | `return y ? x % y : pl.error.evaluation( "zero_divisor", thread.__call_indicator ); }` became `return x % y; }` |
| bh-occurs-check-default | `modules/core.js:4770` | wrong-default | `value: new Term( "false" ),` became `value: new Term( "true" ),` |
| bh-catch-rethrow | `modules/core.js:5641` | swallowed-error | `thread.throw_error(answer.args[0]);` became `thread.prepend([]);` |
| bh-asserta-order | `modules/core.js:6597` | wrong-order | `get_module.rules[head.indicator] = [new Rule(head, body, true)].concat(get_module.rules[head.indicator]);` became `get_module.rules[head.indicator] = get_module.rules[head.indicator].concat([new Rule(head, body, true)]);` |
| bh-numbervars-start | `modules/core.js:6055` | wrong-variable | `var value = start.value;` became `var value = 0;` |
| bh-forall-test-negation | `modules/core.js:5577` | inverted-guard | `new Term( "\\+", [new Term( "call", [test] )] )` became `new Term( "call", [test] )` |
| bh-promise-answers-await | `modules/promises.js:67` | missing-await | `var answer = await this.promiseAnswer();` became `var answer = this.promiseAnswer();` |
| bh-random-between-upper | `modules/random.js:106` | off-by-one | `(upper.value - lower.value + 1)` became `(upper.value - lower.value)` |
| bh-replicate-count | `modules/lists.js:267` | off-by-one | `for( var i = 0; i < times.value; i++ ) {` became `for( var i = 0; i <= times.value; i++ ) {` |
| bh-not-unify-inverted | `modules/core.js:5801` | inverted-guard | `if( mgu === null ) {` became `if( mgu !== null ) {` |
| bh-atom-concat-suffix-guard | `modules/core.js:6854` | missing-guard | `if( str + end.id === whole.id ) {` became `if( str !== undefined ) {` |
| bh-univ-number-head | `modules/core.js:5995` | missing-guard | `\|\| pl.type.is_number( atom.args[1].args[0] )) ) {` became `) ) {` |
| bh-random-float-flag | `modules/random.js:62` | wrong-default | `new pl.type.Num( gen, true )` became `new pl.type.Num( gen, false )` |
| bh-keysort-pair-error | `modules/core.js:6448` | swallowed-error | `thread.throw_error( pl.error.type( "pair", elem, atom.indicator ) );` became `thread.prepend( [] );` |
| bh-compare-args-swapped | `modules/core.js:7352` | wrong-order | `var compare = pl.compare( left, right );` became `var compare = pl.compare( right, left );` |
| bh-setof-as-bagof | `modules/core.js:5905` | wrong-variable | `new Term("$setof", [template, goal, instances])` became `new Term("$bagof", [template, goal, instances])` |
| ca-take-short-list | `modules/lists.js:323` | off-by-one | `if( i === 0 ) {` became `if( i >= 0 ) {` |
| ca-list-to-set-rescan | `modules/lists.js:403` | missing-guard | `j < arr.length && !match` became `j < arr.length` |
| ca-foldr-order | `modules/lists.js:121` | wrong-order | `new pl.type.Term(",", [new pl.type.Term("foldr", [new pl.type.Var("G"),new pl.type.Var("As"),new pl.type.Var("V0"),new pl.type.Var("V1")]),new pl.type.Term("call", [new pl.type.Var("G"),new pl.type.Var("A"),new pl.type.Var("V1"),new pl.type.Var("V2")])])` became `new pl.type.Term(",", [new pl.type.Term("call", [new pl.type.Var("G"),new pl.type.Var("A"),new pl.type.Var("V0"),new pl.type.Var("V1")]),new pl.type.Term("foldr", [new pl.type.Var("G"),new pl.type.Var("As"),new pl.type.Var("V1"),new pl.type.Var("V2")])])` |
| ca-epoch-stat | `modules/statistics.js:93` | wrong-variable | `return new pl.type.Num( thread.epoch, false );` became `return new pl.type.Num( thread.cpu_time, false );` |
| ca-apply-throws | `modules/js.js:54` | swallowed-error | `thread.throw_error( pl.error.javascript( e.toString(), atom.indicator ) );` became `thread.success( point );` |
| ca-size-file-field | `modules/os.js:626` | wrong-variable | `var filesize = stat.size;` became `var filesize = stat.blksize;` |
| ca-future-done-state | `modules/concurrent.js:58` | inverted-guard | `if(future.state !== FUTURE_PENDING) {` became `if(future.state === FUTURE_PENDING) {` |
| ca-answer-limit-rejects | `modules/promises.js:56` | swallowed-error | `limit: reject` became `limit: resolve` |
| ca-between-single | `modules/core.js:7383` | off-by-one | `if( lower.value <= upper.value ) {` became `if( lower.value < upper.value ) {` |
| ca-sub-atom-length | `modules/core.js:6931` | wrong-variable | `var str = atom1.id.substr( i, j );` became `var str = atom1.id.substr( i, k );` |
| ca-reverse-bad-tail | `modules/lists.js:367` | missing-guard | `!pl.type.is_variable( reversed ) && !pl.type.is_fully_list( reversed )` became `false` |
| ca-permutation-partial | `modules/random.js:143` | missing-guard | removes `\|\| !ins_list && !ins_permutation` |
| ca-random-float-bound | `modules/random.js:81` | inverted-guard | `var float = lower.is_float \|\| upper.is_float;` became `var float = lower.is_float && upper.is_float;` |
| ca-time-elapsed-sign | `modules/statistics.js:10` | wrong-order | `new pl.type.Term("-", [new pl.type.Var("T1"),new pl.type.Var("T0")])` became `new pl.type.Term("-", [new pl.type.Var("T0"),new pl.type.Var("T1")])` |
| ca-json-prolog-pairs | `modules/js.js:177` | wrong-default | `pl.fromJavaScript.apply(json.value, true)` became `pl.fromJavaScript.apply(json.value)` |
| ca-getenv-value-type | `modules/os.js:748` | unsafe-input | `} else if(!pl.type.is_variable(value) && !pl.type.is_atom(value)) {` became `} else if(!pl.type.is_variable(value) && !pl.type.is_atom(value) && !pl.type.is_number(value)) {` |
| ca-future-any-fail | `modules/concurrent.js:209` | off-by-one | `if(future.expected === 0)` became `if(future.expected >= 0)` |
| ca-atomic-list-number | `modules/core.js:7293` | wrong-variable | `id += "" + pointer.args[0].value;` became `id += "" + pointer.args[0].id;` |
| ca-time-weekday | `modules/core.js:8893` | wrong-variable | `new Num(date.getDay(), false)` became `new Num(date.getDate(), false)` |

## Decoys (should NOT be flagged)
| ID | Location | Category | Why it is fine |
|----|----------|----------|----------------|
| bh-functor-arity-sign | `modules/core.js:5929` | wrong-variable | an equivalent rewrite that keeps its oracle green: `if( atom.args[2].value >= 0 ) {` became `if( arity.value >= 0 ) {` |
| bh-assertz-append | `modules/core.js:6646` | wrong-order | an equivalent rewrite that keeps its oracle green: `get_module.rules[head.indicator].push(new Rule(head, body, true));` became `get_module.rules[head.indicator] = get_module.rules[head.indicator].concat([new Rule(head, body, true)]);` |
| bh-nth1-lower-bound | `modules/lists.js:196` | off-by-one | an equivalent rewrite that keeps its oracle green: `new pl.type.Term(">", [new pl.type.Var("X"),new pl.type.Num(0, false)]),new pl.type.Term(",", [new pl.type.Term("nth", [new pl.type.Num(1, false),new pl.type.Var("X"),new pl.type.Var("Y"),new pl.type.Var("Z"),new pl.type.Var("_")])` became `new pl.type.Term(">=", [new pl.type.Var("X"),new pl.type.Num(0, false)]),new pl.type.Term(",", [new pl.type.Term("nth", [new pl.type.Num(1, false),new pl.type.Var("X"),new pl.type.Var("Y"),new pl.type.Var("Z"),new pl.type.Var("_")])` |
| bh-abolish-arity-limit | `modules/core.js:6792` | off-by-one | an equivalent rewrite that keeps its oracle green: `&& predicate.args[1].value > thread.get_flag("max_arity").value) {` became `&& predicate.args[1].value >= thread.get_flag("max_arity").value) {` |
| bh-arith-compare-order | `modules/core.js:4891` | wrong-order | an equivalent rewrite that keeps its oracle green: `return expr1.value < expr2.value ? -1 : (expr1.value > expr2.value ? 1 : 0);` became `return expr1.value > expr2.value ? 1 : (expr1.value < expr2.value ? -1 : 0);` |
| bh-number-codes-point | `modules/core.js:7197` | wrong-variable | an equivalent rewrite that keeps its oracle green: `new Num( codePointAt(str,i), false )` became `new Num( str.charCodeAt(i), false )` |
| bh-keygroup-search-stop | `modules/core.js:6509` | missing-guard | an equivalent rewrite that keeps its oracle green: removes `break;` |
| bh-max-list-tie | `modules/lists.js:163` | off-by-one | an equivalent rewrite that keeps its oracle green: `new pl.type.Term(">=", [new pl.type.Var("X"),new pl.type.Var("Y")])` became `new pl.type.Term(">", [new pl.type.Var("X"),new pl.type.Var("Y")])` |
| bh-permutation-shuffle-bound | `modules/random.js:156` | off-by-one | an equivalent rewrite that keeps its oracle green: `for( i = 0; i < array.length; i++ ) {` became `for( i = 0; i < array.length - 1; i++ ) {` |
| ca-future-all-count | `modules/concurrent.js:134` | off-by-one | an equivalent rewrite that keeps its oracle green: `future.state === FUTURE_PENDING && future.expected === 0` became `future.state === FUTURE_PENDING && future.expected <= 0` |
| ca-time-property-input | `modules/core.js:8855` | missing-guard | an equivalent rewrite that keeps its oracle green: `else if(!pl.type.is_variable(time) && !pl.type.is_number(time)) {` became `else if(!pl.type.is_number(time)) {` |
| ca-getenv-text | `modules/os.js:769` | unsafe-input | an equivalent rewrite that keeps its oracle green: `new pl.type.Term(process.env[name.id].toString(), [])` became `new pl.type.Term("" + process.env[name.id], [])` |
| ca-random-member-index | `modules/random.js:128` | off-by-one | an equivalent rewrite that keeps its oracle green: `var gen = Math.floor(thread.get_random_generator().next() * array.length);` became `var gen = Math.trunc(thread.get_random_generator().next() * array.length);` |
| ca-consult-options | `modules/promises.js:16` | wrong-default | an equivalent rewrite that keeps its oracle green: `options = options === undefined ? {} : options;` became `options = options \|\| {};` |
| ca-get-prop-defined | `modules/js.js:87` | missing-guard | an equivalent rewrite that keeps its oracle green: `if( fn !== undefined ) {` became `if( typeof fn !== "undefined" ) {` |
