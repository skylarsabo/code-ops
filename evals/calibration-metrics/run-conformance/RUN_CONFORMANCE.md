# Run conformance — fixture

| check | result | evidence |
| --- | --- | --- |
| ledger-coverage | PASS | 7 dispatches, 7 ledger rows |
| no-dangling | PASS | no row left dispatched |
| tier-routing | FAIL | D-004 reviewer routed below the strong tier |
| effort-routing | PASS | no low effort on a review dispatch |
| artifact-placement | N/A | target repo carries no vault |
| bogus-check | MAYBE | malformed row: result outside the three |
