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
import type { LiveControlPublicRecord } from '../control/contracts.js';
import '../styles/acquisition.css';

export const acquisitionStorageKey = 'exception-broker-acquisition-id';
export const acquisitionAccessKey = 'exception-broker-live-access';
const maxRefreshes = 30;
const refreshIntervalMs = 2_000;

type ExperienceProps = Readonly<{
  api: AcquisitionBrowserApi;
  onNavigateControl: () => void;
  onNavigateHome?: () => void;
  createIdentity?: () => string;
  clock?: () => string;
  onOpenControl?: (record: LiveControlPublicRecord) => void;
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

type FlowStep = Readonly<{ label: string; state: string; tone: 'done' | 'active' | 'waiting' | 'locked' | 'stopped' }>;

const formatTime = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
};

const durationBetween = (startedAt: string | null | undefined, completedAt: string | null | undefined) => {
  if (!startedAt || !completedAt) return null;
  const duration = new Date(completedAt).valueOf() - new Date(startedAt).valueOf();
  if (!Number.isFinite(duration) || duration < 0) return null;
  const seconds = Math.round(duration / 1_000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};

const speakerLabel = (speaker: 'bot' | 'user' | 'unknown') =>
  speaker === 'bot' ? 'CALL-E' : speaker === 'user' ? 'Recipient' : 'Unknown speaker';

function AcquisitionRail({ steps }: Readonly<{ steps: readonly FlowStep[] }>) {
  return <aside className="acq-rail" aria-label="Acquisition flow"><p>Acquisition flow</p><ol>{steps.map((step, index) => <li className={`acq-rail-step is-${step.tone}`} key={step.label}><span aria-hidden="true">{step.tone === 'done' ? '✓' : index + 1}</span><div><strong>{step.label}</strong><small>{step.state}</small></div></li>)}</ol><div className="acq-rail-motif"><q>Higher ground is a choice.</q><span>— The Sentinel</span></div></aside>;
}

function FormationStep({ number, title, detail, state, tone }: Readonly<{ number: number; title: string; detail: string; state: string; tone: string }>) {
  return <li><span>{number}</span><div><strong>{title}</strong><small>{detail}</small></div><b className={`acq-state is-${tone}`}>{state}</b></li>;
}

export const AcquisitionExperience = ({
  api,
  onNavigateControl,
  onNavigateHome,
  createIdentity = () => crypto.randomUUID(),
  clock = () => new Date().toISOString(),
  onOpenControl,
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
  const [handoffPending, setHandoffPending] = useState(false);
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
  const continueToControl = async () => {
    if (accessToken === null || record === null || !ready || handoffPending) return;
    setHandoffPending(true); setMessage('Resolving controlled context and exact review on the server…');
    try { const result = await api.handoff(record.acquisitionId, accessToken); onOpenControl?.(result.record); }
    catch (error: unknown) { setMessage(errorMessage(error)); }
    finally { setHandoffPending(false); }
  };

  const presentation = record === null ? null : createAcquisitionPresentation(record);
  const provider = record?.providerEvidence;
  const attempt = record ? latestAttempt(record) : undefined;
  const safeStop = record?.status === 'completed' && (record.normalizationStatus === 'SAFE_STOP' || record.handoffState === 'SAFE_STOP');
  const ready = record?.status === 'completed' && record.normalizationStatus === 'USABLE' && record.handoffState === 'READY_FOR_REVIEW';
  const transcript = provider?.recipients.flatMap((recipient) => recipient.attempts.flatMap((item) => item.transcriptTurns)) ?? [];

  const failed = presentation?.lifecycle === 'FAILED' || presentation?.lifecycle === 'CANCELED';
  const active = Boolean(record && presentation && !terminal);
  const providerEvidenceAvailable = Boolean(provider && (provider.evidence.length || provider.structuredResult || provider.summary || provider.taskCompleted !== null));
  const flowSteps: readonly FlowStep[] = record === null ? [
    { label: 'Conversation', state: 'READY', tone: 'active' }, { label: 'Evidence', state: 'WAITING', tone: 'waiting' },
    { label: 'Decision', state: 'WAITING', tone: 'waiting' }, { label: 'Control', state: 'LOCKED', tone: 'locked' },
  ] : ready ? [
    { label: 'Conversation', state: 'CAPTURED', tone: 'done' }, { label: 'Evidence', state: 'AVAILABLE', tone: 'done' },
    { label: 'Decision', state: 'FORMED', tone: 'done' }, { label: 'Control', state: 'NEXT', tone: 'active' },
  ] : safeStop ? [
    { label: 'Conversation', state: 'CAPTURED', tone: 'done' }, { label: 'Evidence', state: providerEvidenceAvailable ? 'AVAILABLE' : 'NOT AVAILABLE', tone: providerEvidenceAvailable ? 'done' : 'stopped' },
    { label: 'Decision', state: 'NO USABLE DECISION', tone: 'stopped' }, { label: 'Control', state: 'LOCKED', tone: 'locked' },
  ] : failed ? [
    { label: 'Conversation', state: presentation.lifecycle, tone: 'stopped' }, { label: 'Evidence', state: providerEvidenceAvailable ? 'AVAILABLE' : 'NOT AVAILABLE', tone: providerEvidenceAvailable ? 'done' : 'waiting' },
    { label: 'Decision', state: 'NOT FORMED', tone: 'stopped' }, { label: 'Control', state: 'LOCKED', tone: 'locked' },
  ] : [
    { label: 'Conversation', state: presentation?.lifecycle === 'IN_PROGRESS' ? 'IN PROGRESS' : presentation?.lifecycle ?? 'STARTING', tone: 'active' }, { label: 'Evidence', state: providerEvidenceAvailable ? 'AVAILABLE' : 'WAITING', tone: providerEvidenceAvailable ? 'done' : 'waiting' },
    { label: 'Decision', state: 'WAITING', tone: 'waiting' }, { label: 'Control', state: 'LOCKED', tone: 'locked' },
  ];
  const startedAt = attempt?.startedAt ?? provider?.createdAt ?? record?.createdAt;
  const completedAt = attempt?.completedAt ?? provider?.completedAt;
  const duration = durationBetween(startedAt, completedAt);

  return <div className="app-shell proof-shell acquisition-shell"><header className="product-topbar"><button type="button" className="brand-row product-home-link" onClick={onNavigateHome} aria-label="Exception Broker home"><BrokerMark /><span>Exception Broker</span></button><nav className="product-nav" aria-label="Product">{onNavigateHome ? <button type="button" onClick={onNavigateHome}>Home</button> : null}<button type="button" aria-current="page">Acquisition</button><button type="button" onClick={onNavigateControl}>Control</button></nav><span className="proof-mode"><b>Controlled live</b><span>Acquisition is not authority · no external execution</span></span><ThemeControl /></header>
    <main className="acq-page">
      {accessToken === null ? <section className="access-panel acq-access" aria-labelledby="unlock-title"><p className="eyebrow">Temporary V1 access gate</p><h1 id="unlock-title">Unlock Live Acquisition</h1><p>This token controls demo spending and access. It does not authenticate a business user.</p>{storedId ? <p><strong>Recovery locked.</strong> Acquisition {storedId} remains stored locally; unlock before requesting server truth.</p> : null}<form onSubmit={unlock}><label>Temporary live-access token<input name="liveAccess" type="password" autoComplete="off" /></label><button type="submit">Unlock session</button></form></section> : <div className="acq-layout">
        <AcquisitionRail steps={flowSteps} />
        <div className="acq-main">
          <div className="acq-session"><span><i aria-hidden="true" /> Live access connected</span><small>The token is not business identity.</small><button type="button" onClick={lock}>Configure live access</button></div>
          {record === null && storedId === null ? <>
            <header className="acq-header"><div><p className="eyebrow">CALL-E interaction</p><h1>Acquire a decision</h1><p>Start a controlled call to capture a decision and its provider evidence for exact review.</p></div><span className="acq-status-pill is-ready">READY</span></header>
            <div className="acq-ready-grid"><section className="acq-card acq-start" aria-labelledby="new-acquisition-title"><p className="eyebrow">1 · Conversation</p><h2 id="new-acquisition-title">Start controlled call</h2><p>One live acquisition through the fixed controlled workflow. Starting the call creates no authority and performs no external execution.</p><dl><div><dt>Objective</dt><dd>{ACQUISITION_V1_OBJECTIVE}</dd></div><div><dt>Context</dt><dd>{ACQUISITION_V1_CONTEXT}</dd></div><div><dt>Call authorization</dt><dd>Confirm permission to place this controlled call. The business decision may be captured during the conversation.</dd></div></dl><form onSubmit={create}><label>Recipient phone (E.164)<input aria-label="Recipient phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15551234567" /></label><label className="authorization-check"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /> I confirm this recipient explicitly authorized this controlled call.</label><button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Start CALL-E acquisition'}</button></form></section>
              <section className="acq-card acq-next" aria-label="What happens next"><p className="eyebrow">Controlled path</p><h2>From conversation to control</h2><ol><li><b>1</b><span><strong>Conversation captured</strong><small>CALL-E returns available conversation evidence.</small></span></li><li><b>2</b><span><strong>Provider evidence retained</strong><small>Only returned provider evidence is shown.</small></span></li><li><b>3</b><span><strong>Decision normalized</strong><small>Exception Broker accepts only a usable structured decision.</small></span></li><li><b>4</b><span><strong>Continue to Control</strong><small>Exact human review remains a separate authority boundary.</small></span></li></ol></section></div>
            <section className="acq-resolution is-pending" aria-label="Decision status"><div><p className="eyebrow">Decision status</p><h2>Awaiting live conversation</h2><p>Source: CALL-E · Live acquisition · Evidence pending · Normalization pending</p><strong>No decision is available yet.</strong></div><button type="button" disabled>Continue to Control →</button></section>
          </> : null}
          {record === null && storedId !== null ? <section className="access-panel acq-card" aria-label="Acquisition recovery unavailable"><h1>Recovery unavailable</h1><p>{message || 'Acquisition could not be restored with the current live-access session.'}</p><p>The opaque recovery pointer is preserved. A 404 does not prove the acquisition is missing.</p><button type="button" className="proof-secondary" onClick={reset}>Clear recovery pointer</button></section> : null}
          {record && presentation ? <>
            <header className="acq-header acq-interaction-header"><div><p className="eyebrow">CALL-E interaction</p><h1>{ready || safeStop ? 'Call completed' : presentation.label}</h1><p>{active ? 'Conversation evidence appears as available.' : ready ? 'A usable structured decision is available for exact review.' : safeStop ? 'The provider completed, but no usable decision was established.' : 'The provider interaction ended without a reviewable decision.'}</p></div><span className={`acq-status-pill is-${failed ? 'failed' : ready ? 'complete' : safeStop ? 'stopped' : 'active'}`}>{presentation.lifecycle}</span><dl><div><dt>Provider</dt><dd>CALL-E</dd></div><div><dt>Recipient</dt><dd>{record.maskedRecipient}</dd></div>{duration ? <div><dt>Duration</dt><dd>{duration}</dd></div> : null}<div><dt>Started</dt><dd>{formatTime(startedAt) ?? 'Not available'}</dd></div>{completedAt ? <div><dt>Completed</dt><dd>{formatTime(completedAt)}</dd></div> : null}<div><dt>Attempt</dt><dd>{attempt?.status ?? record.status}</dd></div></dl></header>
            <div className="acq-document-grid"><section className="acq-card acq-conversation" aria-labelledby="conversation-title"><div className="acq-card-heading"><div><p className="eyebrow">1 · Conversation</p><h2 id="conversation-title">{active ? 'Conversation evidence' : 'Conversation'}</h2></div><span>{transcript.length} {transcript.length === 1 ? 'turn' : 'turns'}</span></div>{transcript.length === 0 ? <p className="acq-empty">Conversation evidence not available yet.</p> : <ol className="transcript-timeline">{transcript.slice(0, 4).map((turn, index) => <li key={`${turn.offsetSeconds}-${index}`}><time>{turn.offsetSeconds === null ? 'Time unavailable' : `${String(Math.floor(turn.offsetSeconds / 60)).padStart(2, '0')}:${String(turn.offsetSeconds % 60).padStart(2, '0')}`}</time><strong>{speakerLabel(turn.speaker)}</strong><p>{turn.text}</p></li>)}</ol>}{transcript.length > 4 ? <details className="acq-disclosure"><summary>View full transcript →</summary><ol className="transcript-timeline is-full">{transcript.map((turn, index) => <li key={`full-${turn.offsetSeconds}-${index}`}><time>{turn.offsetSeconds === null ? 'Time unavailable' : `+${turn.offsetSeconds}s`}</time><strong>{speakerLabel(turn.speaker)}</strong><p>{turn.text}</p></li>)}</ol></details> : null}</section>
              <div className="acq-side-stack"><section className="acq-card acq-provider-evidence" aria-labelledby="provider-evidence-title"><div className="acq-card-heading"><div><p className="eyebrow">2 · Evidence</p><h2 id="provider-evidence-title">Provider evidence</h2></div><span>{provider?.evidence.length ?? 0} items</span></div>{provider?.evidence.length ? <ol>{provider.evidence.slice(0, 3).map((item, index) => <li key={index}><b>{String(index + 1).padStart(2, '0')}</b><span>{item}</span></li>)}</ol> : <p className="acq-empty">{active ? 'Provider evidence not available yet.' : 'No provider evidence returned.'}</p>}</section>
                <section className="acq-card acq-formation" aria-label="Decision formation"><div className="acq-card-heading"><div><p className="eyebrow">3 · Decision</p><h2>Decision formation</h2></div></div><ol><FormationStep number={1} title="CALL-E structured result" detail="Provider-returned structured result" state={provider?.structuredResult ? 'AVAILABLE' : active ? 'WAITING' : 'NOT AVAILABLE'} tone={provider?.structuredResult ? 'done' : 'waiting'} /><FormationStep number={2} title="Exception Broker normalization" detail="Structured result checked for usability" state={failed ? 'NOT REACHED' : record.normalizationStatus} tone={failed ? 'stopped' : record.normalizationStatus === 'USABLE' ? 'done' : record.normalizationStatus === 'SAFE_STOP' ? 'stopped' : 'waiting'} /><FormationStep number={3} title="Control eligibility" detail="Exact review remains separate" state={failed ? 'LOCKED' : record.handoffState === 'READY_FOR_REVIEW' ? 'READY FOR REVIEW' : record.handoffState.replaceAll('_', ' ')} tone={failed ? 'locked' : record.handoffState === 'READY_FOR_REVIEW' ? 'ready' : record.handoffState === 'SAFE_STOP' ? 'stopped' : 'locked'} /></ol><p>The provider supplies the structured result. Exception Broker does not infer a decision from transcript text.</p></section></div></div>
            {ready ? <section className="acq-resolution is-ready" aria-label="Control eligibility"><div><p className="eyebrow">Decision acquired</p><h2>{record.normalizedResult?.decision}</h2><p>CALL-E · Live acquisition</p><b>READY FOR REVIEW</b><strong>Acquired decision ≠ execution authority.</strong><span>Eligible for exact review. This decision is available for exact human review in Control. No review, application, or external execution has occurred.</span></div><button type="button" disabled={handoffPending} onClick={() => void continueToControl()}>{handoffPending ? 'Preparing exact review…' : 'Continue to Control'}</button></section> : null}
            {safeStop ? <section className="acq-resolution is-safe-stop" aria-label="Control eligibility"><div><p className="eyebrow">Provider acquisition completed</p><h2>No usable decision established</h2><p><strong>NOT READY FOR REVIEW</strong> · SAFE STOP</p><span>{record.safeStopReason}</span><span>No authority created. No review submitted. No application attempted. No external effect.</span></div><button type="button" disabled>Control locked</button></section> : null}
            {failed ? <section className="acq-resolution is-failed" role="alert"><div><p className="eyebrow">Provider/system outcome</p><h2>{presentation.label}</h2><span>This is not a business SAFE_STOP or Broker disposition. No review or application occurred.</span></div><button type="button" disabled>Control locked</button></section> : null}
            <details className="acq-card acq-provider-depth"><summary>Inspect sanitized provider evidence</summary><div><dl><dt>Acquisition ID</dt><dd>{record.acquisitionId}</dd><dt>Request ID</dt><dd>{record.decisionContext.requestId}</dd><dt>Plan ID</dt><dd>{record.decisionContext.planId}</dd><dt>Masked recipient</dt><dd>{record.maskedRecipient}</dd><dt>Created</dt><dd>{record.createdAt}</dd><dt>Completed</dt><dd>{provider?.completedAt ?? 'not completed'}</dd><dt>Task completed</dt><dd>{provider?.taskCompleted === null || provider?.taskCompleted === undefined ? 'not available' : String(provider.taskCompleted)}</dd><dt>Summary</dt><dd>{provider?.summary ?? 'not available'}</dd><dt>Completion confidence</dt><dd>{provider?.completionConfidence ? `${provider.completionConfidence.score}${provider.completionConfidence.label ? ` · ${provider.completionConfidence.label}` : ''}` : 'not available'}</dd></dl><h3>All provider evidence</h3>{provider?.evidence.length ? <ul>{provider.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None returned.</p>}<h3>Structured result</h3><pre>{provider?.structuredResult ? JSON.stringify(provider.structuredResult, null, 2) : 'No schema-valid structured result returned.'}</pre><div className="acq-provenance"><p><strong>Acquisition provenance</strong> <span>{presentation.acquisitionProvenance}</span>. Real provider acquisition evidence returned by the server.</p><p><strong>Workflow context</strong> <span>Controlled sandbox template</span>. Not live ERP, WMS, customer, or order truth.</p></div></div></details>
            {!terminal && refreshCount >= maxRefreshes ? <section className="bounded-refresh" aria-label="Monitoring stopped"><div><p className="eyebrow">Local monitoring bound reached</p><p>Automatic refresh has stopped. Request one current server status when needed.</p></div><button type="button" disabled={explicitRefreshPending} onClick={() => void refreshStatus()}>{explicitRefreshPending ? 'Refreshing status…' : 'Refresh status'}</button></section> : null}
            <div className="acquisition-reset"><button type="button" className="proof-secondary" onClick={reset}>Clear acquisition recovery pointer</button></div>
          </> : null}
          <p className="acquisition-announcement" aria-live="polite" aria-atomic="true">{message}{refreshCount >= maxRefreshes && !terminal ? ' Monitoring stopped at the local refresh bound.' : ''}</p>
        </div>
      </div>}
    </main><footer>Exception Broker · Decision acquisition ≠ authority to execute</footer></div>;
};
