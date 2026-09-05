import { useEffect, useRef, useState } from 'react';

import {
  ACQUISITION_V1_CONTEXT,
  ACQUISITION_V1_OBJECTIVE,
  AcquisitionApiError,
  createBrowserAcquisitionRequest,
  type AcquisitionBrowserApi,
} from '../acquisition/browserClient.js';
import type { AcquisitionPublicRecord, SanitizedAttempt } from '../acquisition/contracts.js';
import { createAcquisitionPresentation } from '../presentation/acquisitionViewModel.js';
import { BrokerMark } from './CaseHeader.js';
import { ThemeControl } from './ProofExperience.js';

export const acquisitionStorageKey = 'exception-broker-acquisition-id';
export const acquisitionAccessKey = 'exception-broker-live-access';
const maxRefreshes = 30;
const refreshIntervalMs = 2_000;

type ExperienceProps = Readonly<{
  api: AcquisitionBrowserApi;
  onNavigateControl: () => void;
  createIdentity?: () => string;
  clock?: () => string;
}>;

const readStorage = (storage: Storage, key: string) => {
  try { return storage.getItem(key); } catch { return null; }
};
const writeStorage = (storage: Storage, key: string, value: string) => {
  try { storage.setItem(key, value); } catch { /* Storage failure is presented by the absence of recovery. */ }
};
const removeStorage = (storage: Storage, key: string) => {
  try { storage.removeItem(key); } catch { /* The UI remains safely locked. */ }
};
const latestAttempt = (record: AcquisitionPublicRecord): SanitizedAttempt | undefined =>
  record.providerEvidence?.recipients.flatMap((recipient) => recipient.attempts).at(-1);
const errorMessage = (error: unknown) => {
  if (!(error instanceof AcquisitionApiError)) return 'Acquisition service is unavailable.';
  const messages: Record<string, string> = {
    LIVE_CALLING_DISABLED: 'Live acquisition is disabled.', CLIENT_NOT_ALLOWED: 'This live-access session is not allowed.',
    RECIPIENT_NOT_ALLOWED: 'The recipient is not allowed for this controlled workflow.', CALL_LIMIT_REACHED: 'The controlled call limit has been reached.',
    COOLDOWN_ACTIVE: 'Live acquisition is cooling down. No automatic retry was attempted.', ACTIVE_ACQUISITION_EXISTS: 'Another acquisition is already active.',
    PROVIDER_FAILURE: 'The provider operation failed safely.', INVALID_INPUT: 'The acquisition request was rejected as invalid.',
  };
  return messages[error.code] ?? 'Acquisition could not be restored with the current live-access session.';
};

export const AcquisitionExperience = ({
  api,
  onNavigateControl,
  createIdentity = () => crypto.randomUUID(),
  clock = () => new Date().toISOString(),
}: ExperienceProps) => {
  const [accessToken, setAccessToken] = useState(() => readStorage(sessionStorage, acquisitionAccessKey));
  const [storedId, setStoredId] = useState(() => readStorage(localStorage, acquisitionStorageKey));
  const [record, setRecord] = useState<AcquisitionPublicRecord | null>(null);
  const [phone, setPhone] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [explicitRefreshPending, setExplicitRefreshPending] = useState(false);
  const createPending = useRef(false);
  const explicitRefreshLock = useRef(false);

  const terminal = record === null ? false : createAcquisitionPresentation(record).terminal;
  useEffect(() => {
    if (accessToken === null || storedId === null || record !== null) return;
    let active = true;
    setBusy(true);
    void api.get(storedId, accessToken).then((restored) => {
      if (!active) return;
      setRecord(restored); setMessage('Acquisition restored from server truth.'); setRefreshCount(0);
    }).catch(() => {
      if (!active) return;
      setMessage('Acquisition could not be restored with the current live-access session.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accessToken, api, record, storedId]);

  useEffect(() => {
    if (accessToken === null || record === null || terminal || refreshCount >= maxRefreshes) return undefined;
    const timer = window.setTimeout(() => {
      void api.refresh(record.acquisitionId, accessToken).then((result) => {
        setRecord(result.record); setRefreshCount((count) => count + 1); setMessage('');
      }).catch((error: unknown) => { setMessage(errorMessage(error)); setRefreshCount(maxRefreshes); });
    }, refreshIntervalMs);
    return () => window.clearTimeout(timer);
  }, [accessToken, api, record, refreshCount, terminal]);

  const unlock = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form).get('liveAccess');
    if (typeof input !== 'string' || input.length === 0) { setMessage('Enter the temporary live-access token.'); return; }
    writeStorage(sessionStorage, acquisitionAccessKey, input);
    setAccessToken(input); form.reset(); setMessage(storedId ? 'Live access unlocked. Restoring server truth.' : 'Live access unlocked for this browser session.');
  };
  const lock = () => { removeStorage(sessionStorage, acquisitionAccessKey); setAccessToken(null); setRecord(null); setMessage(storedId ? 'Live access locked. Recovery pointer preserved.' : 'Live access locked.'); };
  const reset = () => { removeStorage(localStorage, acquisitionStorageKey); setStoredId(null); setRecord(null); setRefreshCount(0); setMessage('Recovery pointer cleared explicitly.'); };
  const refreshStatus = async () => {
    if (accessToken === null || record === null || terminal || refreshCount < maxRefreshes || explicitRefreshLock.current) return;
    explicitRefreshLock.current = true; setExplicitRefreshPending(true); setMessage('Refreshing status from server truth…');
    try {
      const result = await api.refresh(record.acquisitionId, accessToken);
      setRecord(result.record); setMessage('Status refreshed from server truth.');
    } catch (error: unknown) { setMessage(errorMessage(error)); }
    finally { explicitRefreshLock.current = false; setExplicitRefreshPending(false); }
  };
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (accessToken === null || createPending.current) return;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) { setMessage('Recipient must use E.164 format.'); return; }
    if (!authorized) { setMessage('Confirm explicit recipient authorization before starting.'); return; }
    createPending.current = true; setBusy(true); setMessage('Creating one controlled CALL-E acquisition…');
    try {
      const result = await api.create(createBrowserAcquisitionRequest({ identity: createIdentity(), createdAt: clock(), accessToken, phoneNumber: phone }));
      writeStorage(localStorage, acquisitionStorageKey, result.record.acquisitionId);
      setStoredId(result.record.acquisitionId); setRecord(result.record); setRefreshCount(0); setPhone(''); setAuthorized(false); setMessage('Acquisition accepted. Monitoring server truth.');
    } catch (error: unknown) { setMessage(errorMessage(error)); }
    finally { createPending.current = false; setBusy(false); }
  };

  const presentation = record === null ? null : createAcquisitionPresentation(record);
  const provider = record?.providerEvidence;
  const attempt = record ? latestAttempt(record) : undefined;
  const safeStop = record?.status === 'completed' && (record.normalizationStatus === 'SAFE_STOP' || record.handoffState === 'SAFE_STOP');
  const ready = record?.status === 'completed' && record.normalizationStatus === 'USABLE' && record.handoffState === 'READY_FOR_REVIEW';
  const transcript = provider?.recipients.flatMap((recipient) => recipient.attempts.flatMap((item) => item.transcriptTurns)) ?? [];

  return <div className="app-shell proof-shell acquisition-shell"><header className="product-topbar"><div className="brand-row"><BrokerMark /><span>Exception Broker</span></div><nav className="product-nav" aria-label="Product"><button type="button" aria-current="page">Acquisition</button><button type="button" onClick={onNavigateControl}>Control</button></nav><span className="proof-mode"><b>Controlled live</b><span>Acquisition is not authority · no external execution</span></span><ThemeControl /></header>
    <main className="acquisition-workspace">
      <header className="acquisition-hero"><p className="eyebrow">CALL-E decision acquisition</p><h1>Acquire the decision. Preserve the boundary.</h1><p>A controlled live interaction can produce decision evidence. Exception Broker still determines whether the result is usable for review.</p></header>
      {accessToken === null ? <section className="access-panel" aria-labelledby="unlock-title"><p className="eyebrow">Temporary V1 access gate</p><h2 id="unlock-title">Unlock Live Acquisition</h2><p>This token controls demo spending and access. It does not authenticate a business user.</p>{storedId ? <p><strong>Recovery locked.</strong> Acquisition {storedId} remains stored locally; unlock before requesting server truth.</p> : null}<form onSubmit={unlock}><label>Temporary live-access token<input name="liveAccess" type="password" autoComplete="off" /></label><button type="submit">Unlock session</button></form></section> : <>
        <section className="acquisition-session"><div><p className="eyebrow">Live-access session</p><p>Unlocked in this browser session only. The token is not business identity.</p></div><button type="button" className="proof-secondary" onClick={lock}>Lock live access</button></section>
        {record === null && storedId === null ? <section className="acquisition-create" aria-labelledby="new-acquisition-title"><div><p className="eyebrow">Reviewed V1 workflow</p><h2 id="new-acquisition-title">Start one controlled Client decision acquisition</h2><p><strong>Objective</strong> {ACQUISITION_V1_OBJECTIVE}</p><p><strong>Context</strong> {ACQUISITION_V1_CONTEXT}</p><p>Case, plan, actor, role, and decision vocabulary are fixed correlation metadata—not browser-authored operational truth.</p></div><form onSubmit={create}><label>Recipient phone (E.164)<input aria-label="Recipient phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15551234567" /></label><label className="authorization-check"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /> I confirm this recipient explicitly authorized this controlled call.</label><button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Start CALL-E acquisition'}</button></form></section> : null}
        {record === null && storedId !== null ? <section className="access-panel" aria-label="Acquisition recovery unavailable"><h2>Recovery unavailable</h2><p>{message || 'Acquisition could not be restored with the current live-access session.'}</p><p>The opaque recovery pointer is preserved. A 404 does not prove the acquisition is missing.</p><button type="button" className="proof-secondary" onClick={reset}>Clear recovery pointer</button></section> : null}
      </>}
      <p className="acquisition-announcement" aria-live="polite" aria-atomic="true">{message}{refreshCount >= maxRefreshes && !terminal ? ' Monitoring stopped at the local refresh bound.' : ''}</p>
      {record && presentation ? <>
        <section className="acquisition-status" aria-label="Acquisition status"><div><p className="eyebrow">Live lifecycle</p><h2>{presentation.label}</h2><p>{record.acquisitionId}</p></div><dl><div><dt>Human-facing state</dt><dd>{presentation.lifecycle}</dd></div><div><dt>Provider task</dt><dd>{record.status}</dd></div><div><dt>Latest attempt</dt><dd>{attempt?.status ?? 'not available'}</dd></div><div><dt>Updated</dt><dd>{record.updatedAt}</dd></div></dl></section>
        <section className="decision-formation" aria-label="Decision formation"><h2>Decision formation</h2><ol><li><b>1</b><span>CALL-E interaction</span></li><li><b>2</b><span>Provider evidence &amp; structured result</span></li><li><b>3</b><span>Exception Broker normalization</span></li><li><b>4</b><span>Control eligibility</span></li></ol><p>The provider supplies the structured result. Exception Broker validates and normalizes it; it does not infer a decision from transcript text.</p></section>
        {safeStop ? <section className="eligibility safe-stop" aria-label="Control eligibility"><div><span>Provider outcome</span><strong>{record.status.toUpperCase()}</strong></div><div><span>Control eligibility</span><strong>NOT READY FOR REVIEW</strong></div><h2>The acquisition completed, but no usable APPROVED / REJECTED decision was established.</h2><p>No authority created. No review submitted. No application attempted. No external effect.</p><p>{record.safeStopReason}</p></section> : null}
        {ready ? <section className="eligibility ready-review" aria-label="Control eligibility"><div><span>Decision acquired</span><strong>{record.normalizedResult?.decision}</strong></div><div><span>Control eligibility</span><strong>READY FOR REVIEW</strong></div><h2>Acquired decision ≠ execution authority</h2><p>Eligible for exact review. No authority has been granted. No review or application has occurred.</p></section> : null}
        {presentation.lifecycle === 'FAILED' || presentation.lifecycle === 'CANCELED' ? <section className="provider-error" role="alert"><h2>Provider/system outcome</h2><p>{presentation.label}. This is not a business SAFE_STOP or Broker disposition.</p></section> : null}
        <section className="acquisition-evidence" aria-labelledby="conversation-title"><div className="evidence-heading"><div><p className="eyebrow">Decision provenance · CALL-E · Live acquisition</p><h2 id="conversation-title">Conversation evidence</h2></div><p>Workflow context · Controlled sandbox template</p></div>{transcript.length === 0 ? <p>Conversation evidence will appear when available.</p> : <ol className="transcript-timeline">{transcript.map((turn, index) => <li key={`${turn.offsetSeconds}-${index}`}><time>{turn.offsetSeconds === null ? 'Time unavailable' : `+${turn.offsetSeconds}s`}</time><strong>{turn.speaker}</strong><p>{turn.text}</p></li>)}</ol>}
          <details><summary>Inspect sanitized provider evidence</summary><div className="provider-depth"><dl><dt>Masked recipient</dt><dd>{record.maskedRecipient}</dd><dt>Created</dt><dd>{record.createdAt}</dd><dt>Completed</dt><dd>{provider?.completedAt ?? 'not completed'}</dd><dt>Task completed</dt><dd>{provider?.taskCompleted === null || provider?.taskCompleted === undefined ? 'not available' : String(provider.taskCompleted)}</dd><dt>Summary</dt><dd>{provider?.summary ?? 'not available'}</dd><dt>Completion confidence</dt><dd>{provider?.completionConfidence ? `${provider.completionConfidence.score}${provider.completionConfidence.label ? ` · ${provider.completionConfidence.label}` : ''}` : 'not available'}</dd></dl><h3>Evidence</h3>{provider?.evidence.length ? <ul>{provider.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None returned.</p>}<h3>Structured result</h3><pre>{provider?.structuredResult ? JSON.stringify(provider.structuredResult, null, 2) : 'No schema-valid structured result returned.'}</pre></div></details>
        </section>
        <section className="acquisition-provenance" aria-label="Provenance"><div><span>Acquisition provenance</span><strong>{presentation.acquisitionProvenance}</strong><p>Real provider acquisition evidence returned by the server.</p></div><div><span>Workflow context</span><strong>Controlled sandbox template</strong><p>Controlled synthetic workflow—not resolved operational state or live ERP, WMS, customer, or order truth.</p></div></section>
        {!terminal && refreshCount >= maxRefreshes ? <section className="bounded-refresh" aria-label="Monitoring stopped"><div><p className="eyebrow">Local monitoring bound reached</p><p>Automatic refresh has stopped. Request one current server status when needed.</p></div><button type="button" disabled={explicitRefreshPending} onClick={() => void refreshStatus()}>{explicitRefreshPending ? 'Refreshing status…' : 'Refresh status'}</button></section> : null}
        <div className="acquisition-reset"><button type="button" className="proof-secondary" onClick={reset}>Clear acquisition recovery pointer</button></div>
      </> : null}
    </main><footer>Exception Broker · Decision acquisition ≠ authority to execute</footer></div>;
};
