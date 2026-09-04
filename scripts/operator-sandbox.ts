import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { DecisionAcquisitionSession } from '../src/application/decisionAcquisitionSession.js';
import type { ReviewTarget } from '../src/integrations/calle/decisionBridge.js';
import { operationEffects, presentAttempt } from '../src/presentation/decisionTraceViewModel.js';
import { createOperatorScenario } from '../src/sandbox/operatorScenario.js';

export type OperatorIO = Readonly<{ write: (text: string) => void; ask: (prompt: string) => Promise<string | undefined> }>;
const value = (input: unknown) => JSON.stringify(input) ?? '(absent)';

/** Only schema-bound review content, never an unrestricted SDK/provider object.
 * JSON string quoting preserves whitespace and escapes terminal control characters.
 */
export const formatExactReview = (target: ReviewTarget): string => [
  'Exact retained review — APPLY binds all content below',
  'Source: OFFLINE / MOCK. Completion confidence is informational, not authority.',
  `Operation type: ${value(target.operationType)}`,
  `Case: ${value(target.caseId)}`,
  `Plan: ${value(target.operationType === 'PLAN_DECISION' ? target.planId : undefined)}`,
  `Actor: ${value(target.actorId)} / role: ${value(target.actorRole)}`,
  `Request: ${value(target.requestId)}`,
  `Decision: ${value(target.decision)}`,
  `Summary (complete): ${value(target.summary)}`,
  `Received at: ${value(target.receivedAt)}`,
  `Requires review: ${value(target.requiresReview)} / review state: ${value(target.reviewState)}`,
  `Confidence score: ${value(target.completionConfidence.score)} / label: ${value(target.completionConfidence.label)}`,
  'Authorization changes:',
  ...(target.proposedAuthorizationChanges.length === 0 ? ['  none'] : target.proposedAuthorizationChanges.flatMap((change) => [
    `  Field: ${value(change.field)}`,
    `    Current internal value: ${value(change.currentInternalValue)}; proposed value: ${value(change.proposedNewValue)}`,
    `    External previous value (untrusted): ${value(change.externalPreviousValue)}`,
    `    Reason: ${value(change.reason)}; requires review: ${value(change.requiresReview)}`,
  ])),
  'Evidence (complete, in presented order):',
  ...(target.evidence.length === 0 ? ['  none'] : target.evidence.map((entry, index) => `  ${index + 1}. ${value(entry)}`)),
].join('\n');

const answer = async (io: OperatorIO, prompt: string) => {
  try { return await io.ask(prompt); } catch { return undefined; }
};

export const runOperatorSandbox = async (io: OperatorIO, scenario = createOperatorScenario()) => {
  const session = new DecisionAcquisitionSession(scenario.state, scenario.request, scenario.receivedAt);
  io.write('Exception Broker — Operator Sandbox\nSANDBOX MODE — OFFLINE / MOCK ONLY\nOperational state is synthetic and pre-trusted. No Evidence Boundary ingestion, ERP/WMS connection, phone call or external execution.');
  io.write(`Scenario: ${value(scenario.request.caseId)} / ${value(scenario.request.planId)}\nOperational state: ${value(scenario.state.exceptionCase)}\nRegistered proposal: ${value(scenario.state.plans)}\nSynthetic Supplier/Production setup records: ${scenario.state.approvals.length} decisions, ${scenario.state.operationHistory.length} operations, ${scenario.state.events.length} events. These are not live acquisitions.\nReviewer and timestamps are synthetic sandbox metadata, not authenticated identity or wall-clock evidence.`);
  if (await answer(io, 'Acquire offline operational decision? Type ACQUIRE; anything else stops: ') !== 'ACQUIRE') {
    io.write('WAIT / STOPPED — acquisition not authorized. No provider invocation; no new effects.');
    return;
  }
  const acquired = await session.acquire(scenario.provider);
  if (acquired.status !== 'REVIEWABLE') {
    const detail = acquired.status === 'STOPPED'
      ? acquired.stage === 'MAPPING' || acquired.stage === 'PROVIDER' ? { stage: acquired.stage, ...acquired.mapping }
        : acquired.stage === 'BRIDGE' ? acquired.bridge : { reason: 'NEEDS_CLARIFICATION', reviewState: acquired.bridge.proposal.reviewState }
      : acquired;
    io.write(`WAIT / STOPPED — ${value(detail)}\nNo decision application; zero new effects. Prior synthetic setup records remain.`);
    return;
  }
  io.write(formatExactReview(acquired.bridge.reviewTarget));
  const choice = await answer(io, 'Review THIS exact proposal: APPLY / DISCARD (anything else discards): ');
  const authorizationReviews = [];
  if (choice === 'APPLY') {
    for (const change of acquired.bridge.reviewTarget.proposedAuthorizationChanges) {
      const selected = await answer(io, `Authorization ${change.field}: APPLY / DISCARD (anything else discards): `);
      authorizationReviews.push({ field: change.field, action: selected === 'APPLY' ? 'APPLY' as const : 'DISCARD' as const });
    }
  }
  const reviewed = session.review(choice === 'APPLY'
    ? { ...scenario.reviewMetadata, action: 'APPLY', authorizationReviews }
    : { action: 'DISCARD', operationId: scenario.reviewMetadata.operationId, reviewedBy: scenario.reviewMetadata.reviewedBy,
        reviewedAt: scenario.reviewMetadata.reviewedAt, reason: 'Operator discarded or did not confirm APPLY' });
  if (reviewed.status !== 'REVIEWED') {
    io.write(`WAIT / STOPPED — ${reviewed.reason}`);
    return;
  }
  const { result, before } = reviewed;
  const outcome = !result.accepted && result.failure.reason === 'DISCARDED_BY_REVIEWER'
    ? { label: 'DISCARDED', reason: result.failure.reason }
    : presentAttempt(result, scenario.request.planId!);
  const effects = operationEffects(before, result.state);
  io.write(`Broker outcome: ${value(outcome)}\nExact result: ${value(result.accepted ? { step: result.step, disposition: result.disposition } : result.failure)}\nNew effects only: ${effects.decisions.length} decisions (${effects.approvedCount} APPROVED / ${effects.rejectedCount} REJECTED), ${effects.operations.length} operations, ${effects.events.length} events.\n${effects.stateEvidence}\nLocal effect records: ${value({ decisions: effects.decisions, operations: effects.operations, events: effects.events })}\nLocal sandbox only. No external execution.`);
};

// Importing this module in tests performs no I/O or acquisition.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    process.stderr.write('Operator Sandbox V1 accepts no flags and is offline-only.\n');
    process.exitCode = 1;
  } else {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await runOperatorSandbox({ write: (text) => process.stdout.write(`${text}\n`), ask: (prompt) => terminal.question(prompt) });
    } catch {
      process.stderr.write('Unexpected operator sandbox failure; stopped without retry.\n');
      process.exitCode = 1;
    } finally { terminal.close(); }
  }
}
