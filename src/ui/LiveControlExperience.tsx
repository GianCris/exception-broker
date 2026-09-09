import { useEffect, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import type { AcquisitionBrowserApi } from '../acquisition/browserClient.js';
import { acquisitionAccessKey } from './AcquisitionExperience.js';
import type { LiveControlPublicRecord } from '../control/contracts.js';
import { BrokerMark } from './CaseHeader.js';
import { CentralInstrument } from './CentralInstrument.js';
import { motionTokens } from './motion.js';
import { ThemeControl } from './ProofExperience.js';

export const controlSessionStorageKey = 'exception-broker-control-session-id';
const read = (storage: Storage, key: string) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage: Storage, key: string, value: string) => { try { storage.setItem(key, value); } catch { /* Server truth remains authoritative. */ } };

export const LiveControlExperience = ({ api, initial, onNavigateAcquisition, onNavigateDeterministic, onNavigateHome }: Readonly<{
  api: AcquisitionBrowserApi; initial?: LiveControlPublicRecord; onNavigateAcquisition: () => void; onNavigateDeterministic: () => void;
  onNavigateHome?: () => void;
}>) => {
  const [record, setRecord] = useState<LiveControlPublicRecord | null>(initial ?? null);
  const [access] = useState(() => read(sessionStorage, acquisitionAccessKey));
  const [sessionId] = useState(() => initial?.controlSessionId ?? read(localStorage, controlSessionStorageKey));
  const [reviewOpen, setReviewOpen] = useState(false); const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  const resumableAction = record?.status === 'REVIEWING' ? record.review?.action : undefined;
  useEffect(() => { if (initial) write(localStorage, controlSessionStorageKey, initial.controlSessionId); }, [initial]);
  useEffect(() => {
    if (record || !access || !sessionId) return;
    let active = true; void api.getControl(sessionId, access).then((result) => { if (active) setRecord(result.record); }).catch(() => { if (active) setMessage('Control session could not be restored with the current live-access session.'); });
    return () => { active = false; };
  }, [access, api, record, sessionId]);
  const submit = async (action: 'APPLY' | 'DISCARD') => {
    if (!record || !access || (record.status !== 'AWAITING_REVIEW' && record.status !== 'REVIEWING') || pending) return;
    setPending(true); setMessage('Submitting review intent to the server…');
    try { const result = await api.review(record.controlSessionId, access, action); setRecord(result.record); setReviewOpen(false); setMessage('Server review result recovered.'); }
    catch { setMessage('Review was not accepted. Server truth remains unchanged.'); }
    finally { setPending(false); }
  };
  const receipt = record?.receipt;
  const authority = record?.status === 'AWAITING_REVIEW' ? 'EXACT REVIEW REQUIRED'
    : record?.status === 'REVIEWING' ? resumableAction === undefined ? 'REVIEW INCOMPLETE' : 'REVIEW RESUME REQUIRED'
    : record?.review?.action === 'APPLY' ? 'REVIEWED' : 'DISCARDED';
  const liveAttempt = record?.review?.action === 'APPLY' && receipt ? {
    key: record.review.operationId,
    review: `${record.actorRole} review APPLIED`,
    proposal: `Exact review bound · plan version ${record.planVersion}`,
  } : undefined;
  return <div className="app-shell proof-shell live-control-shell"><header className="product-topbar"><button type="button" className="brand-row product-home-link" onClick={onNavigateHome} aria-label="Exception Broker home"><BrokerMark /><span>Exception Broker</span></button><nav className="product-nav" aria-label="Product">{onNavigateHome ? <button type="button" onClick={onNavigateHome}>Home</button> : null}<button type="button" onClick={onNavigateAcquisition}>Acquisition</button><button type="button" aria-current="page" onClick={onNavigateDeterministic}>Control</button></nav><span className="proof-mode"><b>Live control</b><span>CALL-E decision · controlled local context · no external execution</span></span><ThemeControl /></header>
    <main className="acquisition-workspace live-control-workspace"><header className="acquisition-hero"><p className="eyebrow">Live control session</p><h1>Decision acquired. Authority still required.</h1><p>The server resolved a versioned controlled context and bound this exact review target to one persisted CALL-E acquisition.</p></header>
      {!access ? <section className="access-panel"><h2>Live Control recovery locked</h2><p>The non-sensitive session pointer is preserved. Reconnect CALL-E in Acquisition before restoring server truth.</p><button type="button" onClick={onNavigateAcquisition}>Reconnect CALL-E</button></section> : null}
      {access && !record ? <section className="access-panel"><h2>{message || 'Restoring Live Control session…'}</h2><p>No browser-authored operational state is used.</p></section> : null}
      {record ? <><CentralInstrument
          ariaLabel="Live decision control model"
          decision={record.reviewTarget.decision}
          decisionContext="CALL-E · Live acquisition"
          authority={authority}
          authorityContext="Controlled local operator · not authenticated"
          operationalTruthSummary="CONTROLLED LOCAL SNAPSHOT"
          operationalTruth={<div className="instrument-truth-facts"><article><span>Controlled definition</span><strong>v{record.definitionVersion}</strong><small>{record.definitionId}</small></article><article><span>External operational truth</span><strong>NOT CLAIMED</strong><small>No live ERP/WMS truth</small></article></div>}
          disposition={receipt?.disposition ?? 'NOT RESOLVED'}
          why={receipt?.reason ?? (record.status === 'REVIEWING' ? 'Owned review did not publish a terminal result' : 'No application attempt yet')}
          {...(receipt === undefined ? {} : { effects: `${receipt.effects.decisions} decision, ${receipt.effects.operations} operation, ${receipt.effects.events} event record created locally. No external execution.` })}
          {...(liveAttempt === undefined ? {} : { attempt: liveAttempt })}
        />
        <section className="control-next"><div><p className="eyebrow">Next action</p><h2>{record.status === 'AWAITING_REVIEW' ? 'Review exact decision' : resumableAction !== undefined ? `Resume owned ${resumableAction} review` : record.status === 'REVIEWING' ? 'Review stopped safely' : receipt?.disposition === 'DISCARDED' ? 'Review opportunity closed' : 'Inspect the local result'}</h2><p>Applying asks the existing Broker; it does not guarantee ALLOW.</p></div>{record.status === 'AWAITING_REVIEW' ? <button type="button" onClick={() => setReviewOpen(true)}>Review exact decision</button> : resumableAction !== undefined ? <button type="button" disabled={pending} onClick={() => void submit(resumableAction)}>Resume {resumableAction} review</button> : null}</section>
        <section className="acquisition-provenance"><div><span>Decision source</span><strong>CALL-E · Live acquisition</strong><p>Bound to acquisition {record.acquisitionId}.</p></div><div><span>Operational context</span><strong>Controlled local snapshot</strong><p>{record.definitionId} v{record.definitionVersion} · no live ERP/WMS truth.</p></div></section>
        {receipt ? <section className="action-receipt"><p className="eyebrow">What Changed?</p><h2>{receipt.disposition}</h2><p>{receipt.reason}</p><dl className="proof-effects"><div><dt>New decisions</dt><dd>{receipt.effects.decisions}</dd></div><div><dt>New operations</dt><dd>{receipt.effects.operations}</dd></div><div><dt>New events</dt><dd>{receipt.effects.events}</dd></div></dl><p>Plan status: {receipt.planStatus}. Local controlled effects only; no external execution.</p>{receipt.resolutionScope ? <p>Lineage scope: {receipt.resolutionScope.caseId} / {receipt.resolutionScope.lineageId} / {receipt.resolutionScope.planId}</p> : null}</section> : null}
        <details className="supporting-proof"><summary>Inspect exact source and review binding</summary><div className="provider-depth"><dl><dt>Control session</dt><dd>{record.controlSessionId}</dd><dt>Source call</dt><dd>{record.sourceBinding.callId}</dd><dt>Request</dt><dd>{record.sourceBinding.requestId}</dd><dt>Case / plan</dt><dd>{record.caseId} / {record.planId} v{record.planVersion}</dd><dt>Actor / role</dt><dd>{record.actorId} / {record.actorRole}</dd><dt>Controlled definition</dt><dd>{record.definitionId} v{record.definitionVersion}</dd></dl><pre>{JSON.stringify(record.reviewTarget, null, 2)}</pre></div></details>
        <p className="acquisition-announcement" aria-live="polite">{message}</p>
      </> : null}
    </main><footer>Exception Broker · Decision acquisition ≠ authority to execute</footer>
    {reviewOpen && record ? <MotionConfig reducedMotion="user"><motion.div className="review-backdrop" initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={motionTokens.reveal}><motion.aside className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="live-review-title" initial={{ x: 18, opacity: 0.7 }} animate={{ x: 0, opacity: 1 }} transition={motionTokens.reveal}><button type="button" className="sheet-close" onClick={() => setReviewOpen(false)}>×</button><p className="eyebrow">Exact review · live decision</p><h2 id="live-review-title">Review the {record.actorRole} decision</h2><p>Decision provenance: CALL-E live acquisition.</p><p>Operational context: controlled sandbox context.</p><p>Reviewer: controlled local operator, not authenticated commercial identity.</p><dl><dt>Decision</dt><dd>{record.reviewTarget.decision}</dd><dt>Case / plan</dt><dd>{record.caseId} / {record.planId}</dd><dt>Actor / role</dt><dd>{record.actorId} / {record.actorRole}</dd><dt>Request</dt><dd>{record.reviewTarget.requestId}</dd><dt>Summary</dt><dd>{record.reviewTarget.summary}</dd></dl><pre>{JSON.stringify(record.reviewTarget, null, 2)}</pre><div className="proof-actions"><button type="button" disabled={pending} onClick={() => void submit('APPLY')}>Apply reviewed decision</button><button type="button" className="proof-secondary" disabled={pending} onClick={() => void submit('DISCARD')}>Discard</button></div></motion.aside></motion.div></MotionConfig> : null}
  </div>;
};
