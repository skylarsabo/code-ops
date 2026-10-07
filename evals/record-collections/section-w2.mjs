// Manifest v3, intake, seal, relocate-root, typed events, and the register, from w2-cases.mjs.
import { work, check, run, git, commit, write, generated, rehashAuthorityChain } from './harness.mjs';
import { runW2Cases } from './w2-cases.mjs';

export function runSection() {
  runW2Cases({ work, check, run, git, commit, write, generated, rehashAuthorityChain });
}
