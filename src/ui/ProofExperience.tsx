import { useEffect, useRef, useState } from 'react';
import type { ProofScenario, ProofSession } from '../demo/proofDemo.js';
import { proofScenarios } from '../demo/proofDemo.js';
import { createDecisionControlView, createDecisionTraceView, createDecisionTransitionView, historicalCallProof, type DecisionTraceView, type DecisionTransitionView } from '../presentation/decisionTraceViewModel.js';
import { BrokerMark } from './CaseHeader.js';

type ThemeMode = 'system' | 'light' | 'dark';
const themeStorageKey = 'exception-broker-theme';
const isThemeMode = (value: string | null): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark';

const ThemeControl = () => {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try { const stored = window.localStorage.getItem(themeStorageKey); return isThemeMode(stored) ? stored : 'system'; } catch { return 'system'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  const effectiveTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.dataset.themeMode = mode;
    return () => { delete document.documentElement.dataset.theme; delete document.documentElement.dataset.themeMode; };
  }, [effectiveTheme, mode]);
  const changeMode = (next: ThemeMode) => {
    setMode(next);
    try { window.localStorage.setItem(themeStorageKey, next); } catch { /* Rendering remains deterministic when storage is unavailable. */ }
  };
  return <label className="theme-control"><span>Theme</span><select aria-label="Theme" value={mode} onChange={(event) => changeMode(event.target.value as ThemeMode)}>
    <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
  </select></label>;
};

const attemptVisualFor = (resolved: ProofSession) => {
  const disposition = createDecisionControlView(resolved).disposition;
  if (disposition === 'ALLOW') return { treatment: 'complete' } as const;
  if (disposition === 'BLOCK') return { treatment: 'interrupted' } as const;
  if (disposition === 'WAIT') return { treatment: 'suspended' } as const;
  if (disposition === 'REJECTED') return { treatment: 'neutral' } as const;
  return { treatment: 'neutral-stopped' } as const;
};

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

const Review = ({ view, onReview, onClose }: Readonly<{ view: DecisionTraceView; onReview: (action: 'APPLY' | 'DISCARD') => void; onClose: () => void }>) => {
  const proposal = view.proposal;
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="review-backdrop"><aside ref={dialogRef} className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={onDialogKeyDown}>
    <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label="Close exact review">×</button>
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
  </aside></div>;
};

const ActionReceipt = ({ receipt }: Readonly<{ receipt: DecisionTransitionView }>) => <section className="action-receipt" aria-labelledby="changed-title">
  <p className="eyebrow">Latest completed action</p><h2 id="changed-title">What Changed?</h2><p>{receipt.summary}</p>
  <details><summary>Inspect comparison</summary><div className="receipt-depth">
    <section className="state-comparison" aria-labelledby="comparison-title"><h3 id="comparison-title">State comparison</h3><dl>{receipt.comparison.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><span>{item.before}</span><b aria-hidden="true">→</b><span>{item.after}</span><em>{item.meaning}</em></dd></div>)}</dl></section>
    <section aria-labelledby="local-effects-title"><h3 id="local-effects-title">Local effects</h3>{receipt.effects ? <><dl className="proof-effects"><div><dt>New decisions</dt><dd>{receipt.effects.decisions.length}</dd></div><div><dt>New operations</dt><dd>{receipt.effects.operations.length}</dd></div><div><dt>New events</dt><dd>{receipt.effects.events.length}</dd></div></dl><p>{receipt.effects.stateEvidence}</p></> : <p>No application effects were produced.</p>}</section>
  </div></details>
</section>;

const ReviewApplicationProof = ({ view }: Readonly<{ view: DecisionTraceView }>) => <section className="proof-card review-application-proof" aria-label="Exact review and application proof">
  {view.canReview && view.proposal ? <section aria-labelledby="pending-review-title"><h3 id="pending-review-title">Current pending exact review</h3><dl>
    <dt>Case / plan</dt><dd>{view.proposal.caseId} / {view.proposal.operationType === 'PLAN_DECISION' ? view.proposal.planId : 'Case authorization'}</dd>
    <dt>Actor / role</dt><dd>{view.proposal.actorId} / {view.proposal.actorRole}</dd><dt>Request</dt><dd>{view.proposal.requestId}</dd>
    <dt>Binding</dt><dd>Exact proposal target retained · {view.proposal.reviewState}</dd>
  </dl></section> : <p>No current review is pending.</p>}
  {view.attempts.length > 0 ? <section aria-labelledby="completed-attempts-title"><h3 id="completed-attempts-title">Completed review/application attempts</h3><ol>{view.attempts.map((attempt, index) => {
    const target = attempt.review.reviewTarget;
    return <li key={attempt.review.operationId}><strong>Attempt {index + 1} · {target.actorRole}</strong><dl>
      <dt>Decision / action</dt><dd>{target.decision} / {attempt.review.action}</dd><dt>Case / plan</dt><dd>{target.caseId} / {target.operationType === 'PLAN_DECISION' ? target.planId : 'Case authorization'}</dd>
      <dt>Actor / role</dt><dd>{target.actorId} / {target.actorRole}</dd><dt>Request</dt><dd>{target.requestId}</dd><dt>Exact binding</dt><dd>Bound review target retained</dd>
      <dt>Review metadata</dt><dd>{attempt.review.reviewedBy} · {attempt.review.reviewedAt}</dd><dt>Operation</dt><dd>{attempt.review.operationId}</dd>
    </dl></li>;
  })}</ol></section> : <p>No completed review/application attempt.</p>}
</section>;

const TechnicalResult = ({ view }: Readonly<{ view: DecisionTraceView }>) => {
  const unresolved = view.latest === undefined && view.trustedCaseProduced;
  const disposition = unresolved ? 'NOT RESOLVED' : view.outcome.label;
  return <section className={`proof-card technical-result ${unresolved ? 'proof-unresolved' : `proof-${view.outcome.label.toLowerCase().replaceAll(' ', '-')}`}`} aria-label="Technical result and local effects">
  <h3>Technical result</h3><p className="proof-outcome">{disposition}</p><p className="proof-code">{view.outcome.reason}</p>
  {!view.trustedCaseProduced ? <p>No trusted case produced. Registration and execution/application were not attempted. Resolve the evidence issues externally; no automatic retry.</p> : null}
  {view.latest ? <><p>Completed result for {view.latest.review.reviewTarget.actorRole} {view.latest.review.action} · plan version {view.plan.version}</p>
    {!view.latest.result.accepted ? <ul>{view.latest.result.failure.issues?.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
    <h3>Local effects of this attempt</h3><dl className="proof-effects">
      <div><dt>New decision records</dt><dd>{view.effects?.decisions.length}</dd></div><div><dt>New operations</dt><dd>{view.effects?.operations.length}</dd></div><div><dt>New events</dt><dd>{view.effects?.events.length}</dd></div>
    </dl><p>New decision breakdown: {view.effects?.approvedCount} APPROVED / {view.effects?.rejectedCount} REJECTED.</p><p>{view.effects?.stateEvidence}</p>
    <p className="proof-note">Before this attempt: {view.effects?.previous.decisions} decision records, {view.effects?.previous.operations} operations, {view.effects?.previous.events} events. Counts above are new records, not lifetime totals.</p>
    <p>Plan status: <strong>{view.planStatus}</strong></p>
    <details><summary>Event and lineage evidence</summary><ul>{view.effects?.events.map((event) => <li key={event.eventId}>{event.result} · {event.eventId} · {event.approvalId}</li>)}</ul>{view.scope ? <p>Lineage-scoped resolution: {view.scope.caseId} / {view.scope.lineageId} / {view.scope.planId}</p> : null}</details>
  </> : <p>No decision application attempted. {view.registered ? 'Only local plan registration has occurred; no approvals, operations or events were recorded.' : ''}</p>}
  <p className="proof-note">Local in-memory proof only. No shipment, ERP/WMS write, or external execution.</p>
</section>;
};

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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [applicationAttempt, setApplicationAttempt] = useState<Readonly<{
    before: ProofSession;
    resolved: ProofSession;
    visual: ReturnType<typeof attemptVisualFor>;
  }> | null>(null);
  const [resolvedAnnouncement, setResolvedAnnouncement] = useState('');
  const [receipt, setReceipt] = useState<DecisionTransitionView | null>(null);
  const applicationLock = useRef(false);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const controlSummaryRef = useRef<HTMLElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const reviewWasOpen = useRef(false);
  const reviewCloseDestination = useRef<'trigger' | 'surface'>('trigger');
  const view = createDecisionTraceView(session);
  const control = createDecisionControlView(session);
  const queue = proofScenarios.map((scenario) => ({ scenario, control: createDecisionControlView(
    scenario.id === session.inputs.scenario ? session : prepare(scenario.id),
  ) }));
  useEffect(() => {
    if (applicationAttempt === null) return undefined;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timer = window.setTimeout(() => {
      const resolvedControl = createDecisionControlView(applicationAttempt.resolved);
      setSession(applicationAttempt.resolved);
      setReceipt(createDecisionTransitionView({ beforeSession: applicationAttempt.before, afterSession: applicationAttempt.resolved, action: 'APPLY' }));
      setResolvedAnnouncement(`Broker disposition ${resolvedControl.disposition}. ${resolvedControl.why}`);
      setApplicationAttempt(null);
      applicationLock.current = false;
    }, reducedMotion ? 0 : 700);
    return () => window.clearTimeout(timer);
  }, [applicationAttempt]);
  const onReview = (action: 'APPLY' | 'DISCARD') => {
    // Use the rendered snapshot, not a functional updater that might consume the next
    // role's proposal on a rapid repeated click. Every next proposal needs a new render.
    if (!view.canReview || applicationLock.current) return;
    reviewCloseDestination.current = 'surface';
    if (action === 'APPLY') {
      applicationLock.current = true;
      const resolved = review(session, action);
      setApplicationAttempt({ before: session, resolved, visual: attemptVisualFor(resolved) });
    } else {
      const resolved = review(session, action);
      setSession(resolved);
      setReceipt(createDecisionTransitionView({ beforeSession: session, afterSession: resolved, action: 'DISCARD' }));
    }
    setReviewOpen(false);
  };
  useEffect(() => {
    if (backgroundRef.current) backgroundRef.current.inert = reviewOpen;
    if (reviewOpen) reviewWasOpen.current = true;
    else if (reviewWasOpen.current) {
      reviewWasOpen.current = false;
      (reviewCloseDestination.current === 'trigger' ? reviewButtonRef.current : controlSummaryRef.current)?.focus();
    }
  }, [reviewOpen]);
  const openReview = () => { reviewCloseDestination.current = 'trigger'; setReviewOpen(true); };
  const closeReview = () => { reviewCloseDestination.current = 'trigger'; setReviewOpen(false); };
  const focusScenario = (scenario: ProofScenario) => {
    if (applicationLock.current) return;
    setSession(prepare(scenario)); setReviewOpen(false); setResolvedAnnouncement(''); setReceipt(null);
  };
  return <div className="app-shell proof-shell"><div ref={backgroundRef}><header className="product-topbar"><div className="brand-row"><BrokerMark /><span>Exception Broker</span></div><nav aria-label="Product"><span aria-current="page">Decision control</span></nav><span className="proof-mode" aria-label="Demo environment: deterministic local proof with configured evidence. No external execution."><b>Demo</b><span>Deterministic · configured evidence · local only · No external execution</span></span><ThemeControl /></header>
    <div className="product-layout"><aside className="control-queue" aria-labelledby="queue-title"><p className="eyebrow">Decision control queue</p><h1 id="queue-title">Needs attention</h1><p>Three independent deterministic demo cases.</p>
      <div className="queue-list">{queue.map(({ scenario, control: item }) => <button type="button" key={scenario.id} disabled={applicationAttempt !== null} aria-label={`${scenario.id} / ${scenario.title} · ${item.disposition}`} aria-pressed={view.scenario === scenario.id} onClick={() => focusScenario(scenario.id)}>
        <span className="queue-heading"><span><strong>{scenario.title}</strong><small>Demo case {scenario.id}</small></span><b className={`disposition disposition-${item.disposition.toLowerCase().replace(' ', '-')}`}>{item.disposition}</b></span>
        <span className="queue-state"><b>{item.decision}</b><i aria-hidden="true">·</i><b>{item.authority}</b></span>
        <span className="queue-reason">{item.why}</span><span className="queue-action"><small>Next</small>{item.nextAction}</span>
      </button>)}</div>
      <aside className="queue-history" aria-label="Historical CALL-E evidence"><strong>Historical CALL-E evidence</strong><span>Read-only observed runs · separate from this queue</span></aside>
    </aside><main className="control-workspace">
    <header className="proof-header"><p>Decision control</p><h1>Decision is not authority.</h1><p>The broker evaluates the application attempt—not the word APPROVED.</p></header>
    <section className="case-context" aria-label="Demo case context"><div><h2>{proofScenarios.find(({ id }) => id === view.scenario)?.title}</h2><p>Supply exception <span aria-hidden="true">·</span> Demo case {view.scenario}</p></div><strong>Deterministic workspace</strong></section>
    <section ref={controlSummaryRef} tabIndex={-1} className="control-summary" aria-label="Decision control model">
      <article><span>Decision</span><strong className="decision-neutral">{control.decision}</strong><p>Normalized synthetic input</p></article>
      <article className={view.canReview ? 'control-priority' : ''}><span>Authority</span><strong>{control.authority}</strong><p>{view.canReview ? 'Exact proposal review is still required.' : 'Derived from the current review state.'}</p></article>
      <article><span>Operational truth</span><strong>{control.operationalTruth}</strong><p>Local represented facts only</p></article>
      <article><span>Broker disposition</span><strong className={`disposition-text disposition-${control.disposition.toLowerCase().replace(' ', '-')}`}>{control.disposition}</strong><p>{control.why}</p></article>
    </section>
    {applicationAttempt ? <section className={`application-attempt attempt-${applicationAttempt.visual.treatment}`} aria-label="Application Attempt">
      <div><p className="eyebrow">Application Attempt</p><h2>Applying the reviewed decision to the represented local state</h2></div>
      <dl><div><dt>Decision</dt><dd>{control.decision}</dd></div><div><dt>Proposal</dt><dd>Exact plan version {view.plan.version}</dd></div><div><dt>Review</dt><dd>Exact review bound</dd></div></dl>
      <div className="attempt-continuity" aria-hidden="true"><span /><i /><span /></div>
    </section> : null}
    <p className="resolved-announcement" aria-live="polite" aria-atomic="true">{resolvedAnnouncement}</p>
    <section className={`outcome-language outcome-${control.disposition.toLowerCase().replace(' ', '-')}`} aria-label="Why this disposition">
      <div><p className="eyebrow">Why?</p><h2>{control.why}</h2></div>
      {control.factors.length > 0 ? <dl>{control.factors.map((factor) => <div key={factor.label}><dt>{factor.label}</dt><dd>{factor.value}</dd></div>)}</dl> : null}
      <p className="outcome-therefore"><span>Broker disposition</span><strong>{control.disposition}</strong></p>
      {control.effectSummary ? <p className="outcome-effects">{control.effectSummary}</p> : null}
      {control.disposition === 'ALLOW' ? <p className="outcome-scope">Eligible for local application under the represented controls. No external execution.</p> : null}
    </section>
    <section className="control-next"><div><p className="eyebrow">Next action</p><h2>{control.nextAction}</h2><p>Applying asks the broker; it never bypasses controls.</p></div>{view.canReview && applicationAttempt === null ? <button ref={reviewButtonRef} type="button" onClick={openReview}>Review exact proposal</button> : null}</section>
    <div className="proof-reset"><p>Each demo case starts independent state. H01 is not a repair or inventory update of H02.</p><button type="button" disabled={applicationAttempt !== null} onClick={() => focusScenario(view.scenario)}>Reset demo case</button></div>
    <section className="proof-intent" aria-label="Proposed recovery"><div><p className="eyebrow">Explicit planner proposal / version {view.plan.version}</p><h2>{view.plan.originalQuantityTomorrow} original + {view.plan.substituteQuantityTomorrow} substitute</h2><p>One recovery proposal. No plan generation or autonomous execution.</p></div><details><summary>Plan identity &amp; cost</summary><p>{view.plan.caseId} / {view.plan.id}</p><p>Client cost {view.plan.clientAdditionalCost}; Supplier cost {view.plan.supplierAbsorbedCost}; Production cost {view.plan.productionAbsorbedCost} (demo-case cost units).</p></details></section>
    {receipt ? <ActionReceipt receipt={receipt} /> : null}
    <details className="supporting-proof"><summary>Verify current decision</summary><div className="supporting-proof-content">
      <section aria-labelledby="operational-evidence-group"><h2 id="operational-evidence-group">Operational evidence</h2><Evidence view={view} /></section>
      <section aria-labelledby="review-application-group"><h2 id="review-application-group">Exact review &amp; application</h2><ReviewApplicationProof view={view} /></section>
      <section aria-labelledby="technical-basis-group"><h2 id="technical-basis-group">Technical basis &amp; local effects</h2><Assessments view={view} /><TechnicalResult view={view} /></section>
    </div></details>
    <details className="observed-live"><summary>Observed live validation <span>2 historical runs · read-only</span></summary><aside className="proof-historical" aria-labelledby="historical-title"><p className="eyebrow">Historical · read-only</p><h2 id="historical-title">Observed live validation</h2><p>Real CALL-E interactions observed during operator validation. Not replayed by this browser. Not provenance for the selected deterministic demo case.</p><div className="proof-history-grid">{historicalCallProof.runs.map((run) => <article key={run.name}><h3>{run.name}</h3><p>{run.observation}</p><p>{run.limit}</p></article>)}</div><p><strong>{historicalCallProof.unproven}</strong></p><p className="proof-note">Source: {historicalCallProof.source}</p></aside></details>
  </main></div><footer>Exception Broker · Decision acquisition ≠ authority to execute</footer></div>{reviewOpen ? <Review view={view} onReview={onReview} onClose={closeReview} /> : null}</div>;
};
