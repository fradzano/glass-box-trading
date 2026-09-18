// The certificate run's one deliberate human act, as a decision instead of a
// side effect of reading a line. The shell owns the terminal — prompt, readline,
// signal — and this module owns the only question that matters: does what the
// operator typed clear the halt? Fused into the readline closure it was, by
// measurement, unreachable from every test in the repository, so an inverted
// comparison passed the whole green gate and would have recorded a human
// confirmation for an act no human performed.
export interface FenceUnhaltApproval {
  readonly operator: string;
  readonly reason: string;
}

/** What the operator has to type, and what the prompt has to ask for — one source, so the two cannot drift apart. */
export function fenceUnhaltToken(haltSeq: number): string {
  return `CLEAR-HALT ${String(haltSeq)}`;
}

/** Exactly the token, surrounding whitespace aside; anything else leaves the halt standing. */
export function fenceUnhaltApproval(answer: string, haltSeq: number, operator: string): FenceUnhaltApproval | null {
  if (answer.trim() !== fenceUnhaltToken(haltSeq)) return null;
  return { operator, reason: `human confirmed stable flat fence reconciliation for AUTH_FAILURE halt seq ${String(haltSeq)}` };
}
