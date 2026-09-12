import { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import type { ProofScenario, ProofSession } from '../demo/proofDemo.js';
import { proofScenarios } from '../demo/proofDemo.js';
import { createDecisionControlView, createDecisionTraceView, createDecisionTransitionView, historicalCallProof, type DecisionTraceView, type DecisionTransitionView } from '../presentation/decisionTraceViewModel.js';
import { controlQuestion, createControlQueueItem, createControlSurfaceModel } from '../presentation/controlSurfaceViewModel.js';
import { AttentionQueue, ControlInstrument, ControlKeyTakeaway } from './ControlInstrument.js';
import { ProductBrand } from './ProductShell.js';
import { motionTokens } from './motion.js';

type ThemeMode = 'system' | 'light' | 'dark';
const themeStorageKey = 'exception-broker-theme';
const isThemeMode = (value: string | null): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark';

export const ThemeControl = () => {
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
  return <MotionConfig reducedMotion="user"><motion.div className="review-backdrop" initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={motionTokens.reveal}><motion.aside ref={dialogRef} className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={onDialogKeyDown} initial={{ x: 18, opacity: 0.7 }} animate={{ x: 0, opacity: 1 }} transition={motionTokens.reveal}>
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
  </motion.aside></motion.div></MotionConfig>;
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

export const ProofExperience = ({ prepare, review, onNavigateAcquisition, onNavigateHome, initialScenario = 'H02' }: Readonly<{
  prepare: (scenario: ProofScenario) => ProofSession;
  review: (session: ProofSession, action: 'APPLY' | 'DISCARD') => ProofSession;
  onNavigateAcquisition?: () => void;
  onNavigateHome?: () => void;
  initialScenario?: ProofScenario;
}>) => {
  const [session, setSession] = useState(() => prepare(initialScenario));
  const [reviewOpen, setReviewOpen] = useState(false);
  const [resolvedAnnouncement, setResolvedAnnouncement] = useState('');
  const [receipt, setReceipt] = useState<DecisionTransitionView | null>(null);
  const applicationLock = useRef(false);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const controlSummaryRef = useRef<HTMLElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const reviewWasOpen = useRef(false);
  const reviewCloseDestination = useRef<'trigger' | 'surface'>('trigger');
  const view = createDecisionTraceView(session);
  const model = createControlSurfaceModel(session);
  const queue = proofScenarios.map((scenario) => createControlQueueItem(
    scenario.id === session.inputs.scenario ? session : prepare(scenario.id),
    scenario.id, scenario.title, `Demo case ${scenario.id}`,
  ));
  useEffect(() => { applicationLock.current = false; }, [session]);
  const onReview = (action: 'APPLY' | 'DISCARD') => {
    // Use the rendered snapshot, not a functional updater that might consume the next
    // role's proposal on a rapid repeated click. Every next proposal needs a new render.
    if (!view.canReview || applicationLock.current) return;
    reviewCloseDestination.current = 'surface';
    applicationLock.current = true;
    const resolved = review(session, action);
    setSession(resolved);
    setReceipt(createDecisionTransitionView({ beforeSession: session, afterSession: resolved, action }));
    if (action === 'APPLY') {
      const resolvedControl = createDecisionControlView(resolved);
      setResolvedAnnouncement(`Broker disposition ${resolvedControl.disposition}. ${resolvedControl.why}`);
    }
    setReviewOpen(false);
  };
  useEffect(() => {
    if (backgroundRef.current) backgroundRef.current.inert = reviewOpen;
    if (reviewOpen) reviewWasOpen.current = true;
    else if (reviewWasOpen.current) {
      reviewWasOpen.current = false;
      // Focus the stable instrument without moving the camera between states.
      (reviewCloseDestination.current === 'trigger' ? reviewButtonRef.current : controlSummaryRef.current)?.focus({ preventScroll: true });
    }
  }, [reviewOpen]);
  const openReview = () => { reviewCloseDestination.current = 'trigger'; setReviewOpen(true); };
  const closeReview = () => { reviewCloseDestination.current = 'trigger'; setReviewOpen(false); };
  const focusScenario = (scenario: ProofScenario) => {
    if (applicationLock.current) return;
    setSession(prepare(scenario)); setReviewOpen(false); setResolvedAnnouncement(''); setReceipt(null);
  };
  return <div className="app-shell proof-shell control-surface"><div className="control-chassis" ref={backgroundRef}><header className="product-topbar"><button type="button" className="product-home-link" onClick={onNavigateHome} aria-label="Exception Broker home"><ProductBrand /></button><nav className="product-nav" aria-label="Product">{onNavigateHome ? <button type="button" onClick={onNavigateHome}>Home</button> : null}<button type="button" onClick={onNavigateAcquisition}>Acquisition</button><button type="button" aria-current="page">Control</button></nav><div className="product-topbar-actions"><span className="proof-mode" aria-label="Demo environment: deterministic local proof with configured evidence. No external execution."><b>Demo</b><span>Deterministic · configured evidence · local only · No external execution</span></span><ThemeControl /></div></header>
    <div className="product-layout">
    <AttentionQueue items={queue} selectedId={view.scenario} onSelect={(id) => { const selected = proofScenarios.find((scenario) => scenario.id === id); if (selected) focusScenario(selected.id); }} title="Needs attention" description="Three independent deterministic demo cases.">
      <aside className="queue-history" aria-label="Historical CALL-E evidence"><strong>Historical CALL-E evidence</strong><span>Read-only observed runs · separate from this queue</span></aside>
    </AttentionQueue>
    <main className="control-workspace">
    <header className="control-head"><p className="eyebrow">Decision control</p><h1>{controlQuestion}</h1><p>{model.answer}</p>
      <section className="control-context" aria-label="Demo case context"><b>Demo</b><h2>{proofScenarios.find(({ id }) => id === view.scenario)?.title}</h2><small>Supply exception <span aria-hidden="true">·</span> Demo case {view.scenario}</small><strong>Deterministic workspace</strong></section>
    </header>
    <ControlInstrument
      ref={controlSummaryRef}
      ariaLabel="Decision control model"
      model={model}
      reviewAction={view.canReview
        ? <div className="control-review-action"><button ref={reviewButtonRef} type="button" onClick={openReview}>Review exact proposal <span aria-hidden="true">→</span></button><small>{model.nextActionNote}</small></div>
        : model.review.state === 'COMPLETED'
          ? <p className="control-review-done"><i aria-hidden="true">✓</i><small>{model.review.detail}</small></p>
          : null}
    />
    <p className="resolved-announcement" aria-live="polite" aria-atomic="true">{resolvedAnnouncement}</p>
    {/* The dock holds guidance and proof. Level 1 keeps its height; depth opens as a local drawer. */}
    <div className="control-dock">
      <div className="control-dock-top">
        {model.takeaway ? <ControlKeyTakeaway takeaway={model.takeaway} tone={model.disposition.tone} /> : null}
        <div className="control-dock-tools">
          <button type="button" className="dock-reset" onClick={() => focusScenario(view.scenario)}>Reset demo case</button>
          <details className="supporting-proof"><summary>Verify current decision</summary><div className="control-drawer"><div className="supporting-proof-content">
            <p className="drawer-note">Each demo case starts independent state. H01 is not a repair or inventory update of H02. One recovery proposal; no plan generation or autonomous execution.</p>
            <section aria-labelledby="operational-evidence-group"><h2 id="operational-evidence-group">Operational evidence</h2><Evidence view={view} /></section>
            <section aria-labelledby="review-application-group"><h2 id="review-application-group">Exact review &amp; application</h2><ReviewApplicationProof view={view} /></section>
            <section aria-labelledby="technical-basis-group"><h2 id="technical-basis-group">Technical basis &amp; local effects</h2><Assessments view={view} /><TechnicalResult view={view} /><section className="proof-card proof-plan-identity" aria-label="Plan identity and cost"><h3>Plan identity &amp; cost</h3><p>{view.plan.caseId} / {view.plan.id} · version {view.plan.version}</p><p>Client cost {view.plan.clientAdditionalCost}; Supplier cost {view.plan.supplierAbsorbedCost}; Production cost {view.plan.productionAbsorbedCost} (demo-case cost units).</p></section></section>
          </div></div></details>
          <details className="observed-live"><summary>Observed live validation <span>2 historical runs · read-only</span></summary><div className="control-drawer"><aside className="proof-historical" aria-labelledby="historical-title"><p className="eyebrow">Historical · read-only</p><h2 id="historical-title">Observed live validation</h2><p>Real CALL-E interactions observed during operator validation. Not replayed by this browser. Not provenance for the selected deterministic demo case.</p><div className="proof-history-grid">{historicalCallProof.runs.map((run) => <article key={run.name}><h3>{run.name}</h3><p>{run.observation}</p><p>{run.limit}</p></article>)}</div><p><strong>{historicalCallProof.unproven}</strong></p><p className="proof-note">Source: {historicalCallProof.source}</p></aside></div></details>
        </div>
      </div>
      <div className="control-dock-bar">
        {view.canReview ? null : <section className="control-next"><p className="eyebrow">Next action</p><h2>{model.nextAction}</h2></section>}
        {receipt ? <ActionReceipt receipt={receipt} /> : null}
      </div>
    </div>
  </main></div></div>{reviewOpen ? <Review view={view} onReview={onReview} onClose={closeReview} /> : null}</div>;
};
