import { useEffect, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import type { AcquisitionBrowserApi } from '../acquisition/browserClient.js';
import { acquisitionAccessKey } from './AcquisitionExperience.js';
import type { LiveControlPublicRecord } from '../control/contracts.js';
import { controlQuestion, createLiveControlSurfaceModel } from '../presentation/controlSurfaceViewModel.js';
import { BrokerMark } from './CaseHeader.js';
import { ControlInstrument } from './ControlInstrument.js';
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
  const model = record === null ? undefined : createLiveControlSurfaceModel(record);
  return <div className="app-shell proof-shell control-surface live-control-shell"><header className="product-topbar"><button type="button" className="brand-row product-home-link" onClick={onNavigateHome} aria-label="Exception Broker home"><BrokerMark /><span>Exception Broker</span></button><nav className="product-nav" aria-label="Product">{onNavigateHome ? <button type="button" onClick={onNavigateHome}>Home</button> : null}<button type="button" onClick={onNavigateAcquisition}>Acquisition</button><button type="button" aria-current="page" onClick={onNavigateDeterministic}>Control</button></nav><span className="proof-mode"><b>Live control</b><span>CALL-E decision · controlled local context · no external execution</span></span><ThemeControl /></header>
    <main className="control-workspace live-control-workspace"><header className="control-head"><p className="eyebrow">Live decision control</p><h1>{controlQuestion}</h1><p>{model?.answer ?? 'The server resolved a versioned controlled context and bound this exact review target to one persisted CALL-E acquisition.'}</p>
        <section className="control-context" aria-label="Live control session context"><b>Live</b><h2>CALL-E · Live acquisition</h2><small>Controlled local operational context</small><strong>No external execution</strong></section>
      </header>
      {!access ? <section className="access-panel"><h2>Live Control recovery locked</h2><p>The non-sensitive session pointer is preserved. Reconnect CALL-E in Acquisition before restoring server truth.</p><button type="button" onClick={onNavigateAcquisition}>Reconnect CALL-E</button></section> : null}
      {access && !record ? <section className="access-panel"><h2>{message || 'Restoring Live Control session…'}</h2><p>No browser-authored operational state is used.</p></section> : null}
      {record && model ? <><ControlInstrument
          ariaLabel="Live decision control model"
          model={model}
          reviewAction={record.status === 'AWAITING_REVIEW'
            ? <div className="control-review-action"><button type="button" onClick={() => setReviewOpen(true)}>Review exact decision <span aria-hidden="true">→</span></button><small>{model.nextActionNote}</small></div>
            : resumableAction !== undefined
              ? <div className="control-review-action"><button type="button" disabled={pending} onClick={() => void submit(resumableAction)}>Resume {resumableAction} review</button><small>Server truth remains authoritative until the review publishes a terminal result.</small></div>
              : model.review.state === 'COMPLETED'
                ? <p className="control-review-done"><i aria-hidden="true">✓</i><small>{model.review.detail}</small></p>
                : null}
        />
        {record.status === 'AWAITING_REVIEW' || resumableAction !== undefined ? null : <section className="control-next"><div><p className="eyebrow">Next action</p><h2>{model.nextAction}</h2><p>Applying asks the existing Broker; it does not guarantee ALLOW.</p></div></section>}
        {receipt ? <section className="action-receipt"><p className="eyebrow">What Changed?</p><h2>{receipt.disposition}</h2><p>{receipt.reason}</p><dl className="proof-effects"><div><dt>New decisions</dt><dd>{receipt.effects.decisions}</dd></div><div><dt>New operations</dt><dd>{receipt.effects.operations}</dd></div><div><dt>New events</dt><dd>{receipt.effects.events}</dd></div></dl><p>Plan status: {receipt.planStatus}. Local controlled effects only; no external execution.</p>{receipt.resolutionScope ? <p>Lineage scope: {receipt.resolutionScope.caseId} / {receipt.resolutionScope.lineageId} / {receipt.resolutionScope.planId}</p> : null}</section> : null}
        <details className="supporting-proof"><summary>Inspect exact source and review binding</summary><div className="provider-depth"><dl><dt>Control session</dt><dd>{record.controlSessionId}</dd><dt>Source call</dt><dd>{record.sourceBinding.callId}</dd><dt>Request</dt><dd>{record.sourceBinding.requestId}</dd><dt>Case / plan</dt><dd>{record.caseId} / {record.planId} v{record.planVersion}</dd><dt>Actor / role</dt><dd>{record.actorId} / {record.actorRole}</dd><dt>Controlled definition</dt><dd>{record.definitionId} v{record.definitionVersion}</dd></dl><pre>{JSON.stringify(record.reviewTarget, null, 2)}</pre></div></details>
        <p className="acquisition-announcement" aria-live="polite">{message}</p>
      </> : null}
    </main><footer>Exception Broker · Decision acquisition ≠ authority to execute</footer>
    {reviewOpen && record ? <MotionConfig reducedMotion="user"><motion.div className="review-backdrop" initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={motionTokens.reveal}><motion.aside className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="live-review-title" initial={{ x: 18, opacity: 0.7 }} animate={{ x: 0, opacity: 1 }} transition={motionTokens.reveal}><button type="button" className="sheet-close" onClick={() => setReviewOpen(false)}>×</button><p className="eyebrow">Exact review · live decision</p><h2 id="live-review-title">Review the {record.actorRole} decision</h2><p>Decision provenance: CALL-E live acquisition.</p><p>Operational context: controlled sandbox context.</p><p>Reviewer: controlled local operator, not authenticated commercial identity.</p><dl><dt>Decision</dt><dd>{record.reviewTarget.decision}</dd><dt>Case / plan</dt><dd>{record.caseId} / {record.planId}</dd><dt>Actor / role</dt><dd>{record.actorId} / {record.actorRole}</dd><dt>Request</dt><dd>{record.reviewTarget.requestId}</dd><dt>Summary</dt><dd>{record.reviewTarget.summary}</dd></dl><pre>{JSON.stringify(record.reviewTarget, null, 2)}</pre><div className="proof-actions"><button type="button" disabled={pending} onClick={() => void submit('APPLY')}>Apply reviewed decision</button><button type="button" className="proof-secondary" disabled={pending} onClick={() => void submit('DISCARD')}>Discard</button></div></motion.aside></motion.div></MotionConfig> : null}
  </div>;
};
