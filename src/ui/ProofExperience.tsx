import { useState } from 'react';
import type { ProofScenario, ProofSession } from '../demo/proofDemo.js';
import { proofScenarios } from '../demo/proofDemo.js';
import { createDecisionTraceView, historicalCallProof, type DecisionTraceView } from '../presentation/decisionTraceViewModel.js';
import { BrokerMark } from './CaseHeader.js';

const Evidence = ({ view }: Readonly<{ view: DecisionTraceView }>) => <section className="proof-card" aria-labelledby="evidence-title">
  <p className="eyebrow">01 / Operational evidence</p>
  <h2 id="evidence-title">{view.trustedCaseProduced ? 'Trusted snapshot facts' : 'Input claims — not a trusted snapshot'}</h2>
  <p>Deterministic demo evidence. Configured ERP / WMS sources are not live connections.</p>
  <div className="proof-table-scroll"><table className="proof-table"><caption>Assembly: {view.assemblyStatus}</caption><thead><tr><th>Fact / value</th><th>Configured source</th><th>Trust status</th></tr></thead><tbody>
    {view.facts.map((fact) => <tr key={fact.evidenceId}><td><strong>{fact.label}</strong><span>{fact.value}</span></td><td>{fact.sourceId}<small>Authority configured for {fact.label.toLowerCase()}</small></td><td>{fact.trusted ? 'Accepted evidence' : 'Unaccepted input claim'}
      <details><summary>Evidence details</summary><dl><dt>Evidence ID</dt><dd>{fact.evidenceId}</dd><dt>Observed at</dt><dd>{fact.observedAt}</dd><dt>Effective at</dt><dd>{fact.effectiveAt}</dd><dt>Authoritative source</dt><dd>{fact.authority}</dd></dl></details>
    </td></tr>)}
  </tbody></table></div>
  <p className="proof-note">Authority is configured, not authenticated. Source identity and stable case configuration are trusted upstream. Snapshot matching is not general freshness or latest-state synchronization.</p>
  <details><summary>Snapshot &amp; trust basis</summary><p>Requested snapshot: {view.effectiveAt}</p><p>Delivery commitment: {view.deliveryAt}</p><p>Authorization and supply establish different facts; differing quantities are not an evidence conflict.</p></details>
  {view.assemblyIssues.length > 0 ? <ul className="proof-issues">{view.assemblyIssues.map((issue, index) => <li key={index}>{issue.code}: {issue.message} {issue.factKind}</li>)}</ul> : null}
</section>;

const Review = ({ view, onReview }: Readonly<{ view: DecisionTraceView; onReview: (action: 'APPLY' | 'DISCARD') => void }>) => {
  const proposal = view.proposal;
  return <section className="proof-card" aria-labelledby="review-title">
    <p className="eyebrow">02 / Explicit review</p><h2 id="review-title">{proposal ? `Review the ${proposal.actorRole} decision` : 'Review not reached'}</h2>
    {proposal ? <>
      <p className="proof-decision">Represented external decision <strong>{proposal.decision}</strong></p>
      <p className="proof-verbatim">{proposal.summary}</p>
      <p>Plan version {view.plan.version} · {proposal.actorRole} · {view.canReview ? 'Awaiting your review' : 'Review interaction closed'}</p>
      <p>Proposed authorization changes: {proposal.proposedAuthorizationChanges.length === 0 ? 'none' : proposal.proposedAuthorizationChanges.length}</p>
      <p className="proof-note">Synthetic decision input, not a live CALL-E response. Review applies to this exact proposal. Applying it asks the broker; it does not bypass safety checks.</p>
      <details><summary>Exact proposal &amp; bound review details</summary><dl>
        <dt>Case</dt><dd>{proposal.caseId}</dd><dt>Plan</dt><dd>{proposal.operationType === 'PLAN_DECISION' ? proposal.planId : 'Case authorization'}</dd>
        <dt>Actor / role</dt><dd>{proposal.actorId} / {proposal.actorRole}</dd><dt>Request</dt><dd>{proposal.requestId}</dd><dt>Received at</dt><dd>{proposal.receivedAt}</dd><dt>Review state</dt><dd>{proposal.reviewState}</dd>
        <dt>Local demo reviewer</dt><dd>{view.reviewer}</dd><dt>Deterministic review timestamp</dt><dd>{view.reviewedAt}</dd>
      </dl><p>Demo metadata, not authenticated reviewer identity or the current wall clock.</p><ul>{proposal.evidence.map((value, index) => <li className="proof-verbatim" key={index}>{value}</li>)}</ul><pre>{JSON.stringify(view.reviewTarget, null, 2)}</pre></details>
      <div className="proof-actions"><button type="button" onClick={() => onReview('APPLY')} disabled={!view.canReview}>Apply reviewed decision</button><button type="button" className="proof-secondary" onClick={() => onReview('DISCARD')} disabled={!view.canReview}>Discard</button></div>
      {view.canReview && view.attempts.length > 0 ? <p>Previous role recorded. This is a new, separate role review; it has not been applied.</p> : null}
    </> : <p>No reviewable proposal. No decision application was attempted.</p>}
  </section>;
};

const Result = ({ view }: Readonly<{ view: DecisionTraceView }>) => <section className={`proof-card proof-result proof-${view.outcome.label.toLowerCase()}`} aria-labelledby="result-title" aria-live="polite">
  <p className="eyebrow">03 / Actual broker outcome</p><p className="proof-outcome">{view.outcome.label}</p><h2 id="result-title">{view.outcome.title}</h2><p className="proof-code">{view.outcome.reason}</p>
  {view.outcome.label === 'ALLOW' ? <section className="proof-allow-basis" aria-label="Why this result is supportable">
    <h3>Why this result is supportable</h3>
    <ul>
      <li>Formal snapshot: {view.assessments ? view.assessments.formal.valid ? 'PLAN_VALID' : 'PLAN_INVALID' : 'unavailable'}.</li>
      <li>Physical snapshot: {view.assessments?.physical.outcome ?? 'unavailable'}.
        {view.assessments?.physical.outcome === 'PHYSICALLY_FEASIBLE' ? <span> {view.assessments.physical.checks.map((check) => `${check.quantityType}: ${check.requiredQuantity} required / ${check.availableQuantity} available`).join('; ')}.</span> : null}</li>
      <li>Exact version: {view.assessments ? view.assessments.currentness.valid ? `version ${view.assessments.currentness.plan.version}, current in its lineage at the attempted snapshot` : view.assessments.currentness.reason : 'unavailable'}.</li>
      <li>Local result: {view.planStatus ?? 'unavailable'} · {view.outcome.reason}. No external execution.</li>
    </ul><p className="proof-note">Supporting snapshot assessments, not a sequential gate-execution trace.</p>
  </section> : null}
  {!view.trustedCaseProduced ? <p>No trusted case produced. Registration and execution/application were not attempted. Resolve the evidence issues externally; no automatic retry.</p> : null}
  {view.latest ? <><p>Attempted {view.latest.review.action} · {view.latest.review.reviewTarget.actorRole} · plan version {view.plan.version}</p>
    {!view.latest.result.accepted ? <ul>{view.latest.result.failure.issues?.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
    <h3>Effects of this attempt only</h3><dl className="proof-effects">
      <div><dt>New decision records</dt><dd>{view.effects?.decisions.length}</dd></div><div><dt>New operations</dt><dd>{view.effects?.operations.length}</dd></div><div><dt>New events</dt><dd>{view.effects?.events.length}</dd></div>
    </dl><p>New decision breakdown: {view.effects?.approvedCount} APPROVED / {view.effects?.rejectedCount} REJECTED.</p><p>{view.effects?.stateEvidence}</p>
    <p className="proof-note">Before this attempt: {view.effects?.previous.decisions} decision records, {view.effects?.previous.operations} operations, {view.effects?.previous.events} events. Counts above are new records, not lifetime totals.</p>
    <p>Plan status: <strong>{view.planStatus}</strong></p>
    <details><summary>Operation evidence</summary><p>{view.latest.review.operationId}</p><ul>{view.effects?.events.map((event) => <li key={event.eventId}>{event.result} · {event.eventId} · {event.approvalId}</li>)}</ul>{view.scope ? <p>Lineage-scoped resolution: {view.scope.caseId} / {view.scope.lineageId} / {view.scope.planId}</p> : null}</details>
  </> : <p>No decision application attempted. {view.registered ? 'Only local plan registration has occurred; no approvals, operations or events were recorded.' : ''}</p>}
  <p className="proof-note">Local in-memory proof only. No shipment, ERP/WMS write, or external execution.</p>
</section>;

const Assessments = ({ view }: Readonly<{ view: DecisionTraceView }>) => {
  const assessments = view.assessments;
  if (!assessments) return null;
  const physical = assessments.physical;
  return <section className="proof-card proof-assessments" aria-labelledby="assess-title"><p className="eyebrow">Supporting explanation</p><h2 id="assess-title">Pre-attempt snapshot assessments</h2>
    <p>Read-only domain queries of the attempted snapshot. This is not a chronological gate-execution log.</p>
    <div className="proof-assessment-grid"><article><h3>Formal / authorization</h3><p>{assessments.formal.valid ? 'PLAN_VALID' : 'PLAN_INVALID'}</p><p>Proposed substitutes: {assessments.substituteRequired}. Configured Client limit: {assessments.substituteAuthorized ?? 'unavailable'}.</p><ul>{assessments.formal.violations.map((violation, index) => <li key={index}>{violation.ruleId}: {violation.message}</li>)}</ul></article>
    <article><h3>Physical feasibility</h3><p>{physical.outcome}</p>{physical.outcome === 'PHYSICALLY_FEASIBLE' ? <ul>{physical.checks.map((check) => <li key={check.planField}>{check.quantityType}: {check.requiredQuantity} required / {check.availableQuantity} available</li>)}</ul> : <ul>{(physical.outcome === 'PHYSICALLY_INFEASIBLE' ? physical.violations : physical.issues).map((detail, index) => <li key={index}>{detail.code}: {detail.requiredQuantity ?? 'unknown'} required / {detail.availableQuantity ?? 'unproven'} available</li>)}</ul>}</article>
    <article><h3>Exact plan / version</h3><p>{assessments.currentness.valid ? 'Current in its lineage at the attempted snapshot' : assessments.currentness.reason}</p><p>Version {view.plan.version}. Approvals apply to this exact plan, not every version.</p></article></div>
  </section>;
};

export const ProofExperience = ({ prepare, review }: Readonly<{
  prepare: (scenario: ProofScenario) => ProofSession;
  review: (session: ProofSession, action: 'APPLY' | 'DISCARD') => ProofSession;
}>) => {
  const [session, setSession] = useState(() => prepare('H02'));
  const view = createDecisionTraceView(session);
  const onReview = (action: 'APPLY' | 'DISCARD') => {
    // Use the rendered snapshot, not a functional updater that might consume the next
    // role's proposal on a rapid repeated click. Every next proposal needs a new render.
    if (view.canReview) setSession(review(session, action));
  };
  return <div className="app-shell proof-shell"><main>
    <header className="proof-header"><div className="brand-row"><BrokerMark /><span>Exception Broker</span></div><p className="eyebrow">Deterministic execution-control proof</p><h1>An approval is not permission to execute.</h1><p>Trusted facts. An exact proposal. Your review. The broker decides whether the action can take effect.</p><span className="proof-mode">Local in-memory demonstration · No live calls or integrations</span></header>
    <nav className="proof-scenarios" aria-label="Independent proof scenarios">{proofScenarios.map((scenario) => <button type="button" key={scenario.id} aria-pressed={view.scenario === scenario.id} onClick={() => setSession(prepare(scenario.id))}><strong>{scenario.id} / {scenario.title}</strong><span>{scenario.description}</span></button>)}</nav>
    <div className="proof-reset"><p>Each selection starts independent state. H01 is not a repair or inventory update of H02.</p><button type="button" onClick={() => setSession(prepare(view.scenario))}>Reset this scenario</button></div>
    <section className="proof-intent" aria-label="Proposed recovery"><div><p className="eyebrow">Explicit planner proposal / version {view.plan.version}</p><h2>{view.plan.originalQuantityTomorrow} original + {view.plan.substituteQuantityTomorrow} substitute</h2><p>One recovery proposal. No plan generation or autonomous execution.</p></div><details><summary>Plan identity &amp; cost</summary><p>{view.plan.caseId} / {view.plan.id}</p><p>Client cost {view.plan.clientAdditionalCost}; Supplier cost {view.plan.supplierAbsorbedCost}; Production cost {view.plan.productionAbsorbedCost} (scenario cost units).</p></details></section>
    <Evidence view={view} /><div className="proof-decision-grid"><Review view={view} onReview={onReview} /><Result view={view} /></div><Assessments view={view} />
    {view.attempts.length > 0 ? <details className="proof-card"><summary>Earlier / current review attempts ({view.attempts.length})</summary><ol>{view.attempts.map((attempt) => <li key={attempt.review.operationId}>{attempt.review.reviewTarget.actorRole} · {attempt.review.action} · {attempt.result.accepted ? attempt.result.step.result : attempt.result.failure.reason}</li>)}</ol></details> : null}
    <aside className="proof-historical" aria-labelledby="historical-title"><p className="eyebrow">Historical live CALL-E proof / separate evidence</p><h2 id="historical-title">Real acquisition. A different proof.</h2><p>These reported historical interactions did not produce the scenario above. This browser does not invoke CALL-E.</p><div className="proof-history-grid">{historicalCallProof.runs.map((run) => <article key={run.name}><h3>{run.name}</h3><p>{run.observation}</p><p>{run.limit}</p></article>)}</div><p><strong>{historicalCallProof.unproven}</strong></p><p className="proof-note">Source: {historicalCallProof.source}</p><p className="proof-note">No claim of authenticated human authority, no-answer handling, fallback, or production reliability.</p></aside>
  </main><footer>Exception Broker · Decision acquisition ≠ authority to execute</footer></div>;
};
