import { useEffect, useRef, useState } from 'react';

import {
  ACQUISITION_V1_CONTEXT,
  ACQUISITION_V1_OBJECTIVE,
  AcquisitionApiError,
  createBrowserAcquisitionRequest,
  reconcileBrowserAcquisitionRequest,
  type AcquisitionBrowserApi,
  type BrowserAcquisitionCreateInput,
} from '../acquisition/browserClient.js';
import { isTerminalStatus, type AcquisitionPublicRecord, type AcquisitionTechnicalFailure, type SanitizedAttempt, type SanitizedTranscriptTurn } from '../acquisition/contracts.js';
import type { AcquisitionConnectionKind } from '../acquisition/access.js';
import type { LiveControlPublicRecord } from '../control/contracts.js';
import { createAcquisitionPresentation } from '../presentation/acquisitionViewModel.js';
import { ThemeControl } from './ProofExperience.js';
import calleIcon from '../assets/brands/call-e/icon-yellow-256.png';
import calleLogo from '../assets/brands/call-e/logo-yellow-512.png';
import '../styles/acquisition.css';

export const acquisitionStorageKey = 'exception-broker-acquisition-id';
export const acquisitionAccessKey = 'exception-broker-live-access';
export const acquisitionAccessKindKey = 'exception-broker-live-access-kind';
export const acquisitionHostedSessionKey = 'exception-broker-hosted-session';
const maxRefreshes = 66;
const refreshDelayMs = (completedRefreshes: number) => completedRefreshes < 30 ? 2_000 : completedRefreshes < 54 ? 5_000 : 10_000;
const productLogo = '/images/home/exception-broker-logo-transparent.png';

type ExperienceProps = Readonly<{ api: AcquisitionBrowserApi; onNavigateControl: () => void; onNavigateHome?: () => void; createIdentity?: () => string; clock?: () => string; onOpenControl?: (record: LiveControlPublicRecord) => void }>;
type FlowStep = Readonly<{ label: string; state: string; tone: 'done' | 'active' | 'waiting' | 'locked' | 'stopped' }>;

const readStorage = (storage: Storage, key: string) => { try { return storage.getItem(key); } catch { return null; } };
const writeStorage = (storage: Storage, key: string, value: string) => { try { storage.setItem(key, value); } catch { /* Recovery remains safely unavailable. */ } };
const removeStorage = (storage: Storage, key: string) => { try { storage.removeItem(key); } catch { /* The UI remains safely locked. */ } };
const latestAttempt = (record: AcquisitionPublicRecord): SanitizedAttempt | undefined => record.providerEvidence?.recipients.flatMap((recipient) => recipient.attempts).at(-1);
const errorMessage = (error: unknown) => {
  if (!(error instanceof AcquisitionApiError)) return 'Acquisition service is unavailable.';
  const messages: Record<string, string> = {
    LIVE_CALLING_DISABLED: 'Live acquisition is disabled.', CLIENT_NOT_ALLOWED: 'This live-access session is not allowed.', RECIPIENT_NOT_ALLOWED: 'The recipient is not allowed for this controlled workflow.',
    CALL_LIMIT_REACHED: 'The controlled call limit has been reached.', COOLDOWN_ACTIVE: 'Live acquisition is cooling down. No automatic retry was attempted.', ACTIVE_ACQUISITION_EXISTS: 'Another acquisition is already active.',
    PROVIDER_FAILURE: 'The provider operation failed safely.', INVALID_INPUT: 'The acquisition request was rejected as invalid.', HOSTED_ACCESS_UNAVAILABLE: 'Hosted demo access is unavailable. Connect your CALL-E account or try again later.',
    CONNECTION_NOT_FOUND: 'The CALL-E connection expired. Re-establish it to continue.',
  };
  return messages[error.code] ?? 'Acquisition could not be restored with the current live-access session.';
};
const formatTime = (value: string | null | undefined) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }); };
const durationBetween = (startedAt: string | null | undefined, completedAt: string | null | undefined) => { if (!startedAt || !completedAt) return null; const duration = new Date(completedAt).valueOf() - new Date(startedAt).valueOf(); if (!Number.isFinite(duration) || duration < 0) return null; const seconds = Math.round(duration / 1_000); return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`; };
const transcriptOffset = (seconds: number | null) => seconds === null ? 'Time unavailable' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const speakerLabel = (speaker: 'bot' | 'user' | 'unknown') => speaker === 'bot' ? 'CALL-E' : speaker === 'user' ? 'Recipient' : 'Unknown speaker';
const Arrow = ({ className = '' }: Readonly<{ className?: string }> = {}) => <svg className={`acq-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
/** Recipient phone display formatting only. Domain E.164 validation stays in phonePattern. */
const normalizePhoneInput = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  return value.trimStart().startsWith('+') ? `+${digits}` : digits;
};
const phonePattern = /^\+[1-9]\d{7,14}$/;

/** One shared icon family: same viewBox, stroke width and line language for every module glyph. Purely decorative — aria-hidden, never a standalone accessible name. */
const iconAttrs = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
/** Conversation: waveform. */
const IconWaveform = () => <svg {...iconAttrs}><path d="M4 10v4M8 6v12M12 3v18M16 6v12M20 10v4" /></svg>;
/** Provider evidence: a document with a folded corner and evidence lines. */
const IconEvidence = () => <svg {...iconAttrs}><path d="M7 3.5h7l3 3v13.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z" /><path d="M14 3.5V7h3" /><path d="M9 12h6M9 15.5h6M9 8.5h3" /></svg>;
/** Acquired decision: a diamond outline. Never a check — a decision object is not an approval. */
const IconDecision = () => <svg {...iconAttrs}><path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" /></svg>;
/** Acquisition / CALL-E operation: outgoing call. */
const IconCall = () => <svg {...iconAttrs}><path d="M15.5 4.5h4v4" /><path d="M19.5 4.5 14 10" /><path d="M20 16.9v2.6a1.6 1.6 0 0 1-1.7 1.6 15.7 15.7 0 0 1-6.9-2.5 15.5 15.5 0 0 1-4.8-4.8A15.7 15.7 0 0 1 4.1 6.9 1.6 1.6 0 0 1 5.7 5h2.6c.8 0 1.5.6 1.6 1.4.1.8.3 1.5.6 2.2.2.5.1 1.1-.3 1.5L8.8 11a12.6 12.6 0 0 0 4.8 4.8l.9-1.4c.4-.4 1-.5 1.5-.3.7.3 1.4.5 2.2.6.8.1 1.4.8 1.4 1.6Z" /></svg>;
/** Completed lifecycle step only — never an approval signal. */
const IconCheck = () => <svg {...iconAttrs}><path d="M5 12.5 9.5 17 19 6" /></svg>;
/** Acquisition safely stopped: a halted-lifecycle ring, deliberately distinct from both the decision diamond and the completed check. */
const IconStop = () => <svg {...iconAttrs}><circle cx="12" cy="12" r="7.5" /><path d="M9 12h6" /></svg>;

type IndexedTurn = Readonly<{ turn: SanitizedTranscriptTurn; index: number }>;
type TurnGroup = Readonly<{ speaker: SanitizedTranscriptTurn['speaker']; items: readonly IndexedTurn[] }>;
/**
 * Visual grouping only: adjacent raw turns from the same speaker are rendered as one
 * documentary block. Every raw turn stays independently present, in order — nothing is
 * merged, rewritten, reordered or fabricated. See renderTurnGroup.
 */
const groupBySpeaker = (items: readonly IndexedTurn[]): readonly TurnGroup[] => {
  const groups: TurnGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last !== undefined && last.speaker === item.turn.speaker) { (last.items as IndexedTurn[]).push(item); continue; }
    groups.push({ speaker: item.turn.speaker, items: [item] });
  }
  return groups;
};
const renderTurnGroup = (group: TurnGroup, keyPrefix: string) => {
  const first = group.items[0]!;
  return <li key={`${keyPrefix}-${first.index}`} className={`is-${group.speaker}`}>
    <time>{transcriptOffset(first.turn.offsetSeconds)}</time>
    <span className={`acq-speaker is-${group.speaker}`} aria-hidden="true">{group.speaker === 'bot' ? <img src={calleIcon} alt="" width="11" height="12" /> : null}</span>
    <div><strong>{speakerLabel(group.speaker)}</strong>{group.items.map((item, itemIndex) => <p key={`${keyPrefix}-${item.index}`}>{itemIndex > 0 && item.turn.offsetSeconds !== null ? <time className="acq-turn-micro-time">{transcriptOffset(item.turn.offsetSeconds)}</time> : null}{item.turn.text}</p>)}</div>
  </li>;
};

function AcquisitionBrand() { return <span className="acq-brand"><img src={productLogo} alt="Exception Broker logo" width="55" height="39" /><span><strong>Exception Broker</strong><small>Higher ground for brighter decisions.</small></span></span>; }
function Activity({ label }: Readonly<{ label: string }>) { return <span className="acq-activity" role="status"><i aria-hidden="true" />{label}</span>; }
/** Real elapsed time only: ticks from a real timestamp while active, otherwise stays null. Never fabricates progress. */
function useElapsedSeconds(startedAt: string | null | undefined, active: boolean): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    const startMs = startedAt ? Date.parse(startedAt) : Number.NaN;
    if (!active || !Number.isFinite(startMs)) { setElapsed(null); return undefined; }
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1_000)));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt, active]);
  return elapsed;
}
type ActivityPhase = 'QUEUED' | 'IN_PROGRESS' | 'FINALIZING';
const activityCopy: Record<ActivityPhase, Readonly<{ title: string; body: string; footer: string | null }>> = {
  QUEUED: { title: 'Waiting for CALL-E', body: 'CALL-E is preparing the interaction.', footer: 'Transcript will appear here when the provider returns captured turns.' },
  IN_PROGRESS: { title: 'Conversation in progress', body: 'CALL-E interaction is active.', footer: 'Listening for provider transcript…' },
  FINALIZING: { title: 'Finalizing provider result', body: 'The call may be complete while CALL-E prepares the terminal structured result.', footer: null },
};
/**
 * Reuses the same Exception Broker <-> CALL-E signal bridge as the Connection Gate, at
 * instrument scale: QUEUED borrows `idle` (almost dormant, one slow breath), IN_PROGRESS
 * borrows `connecting` (a restrained travelling pulse), FINALIZING borrows `arrived` (the
 * signal converges and settles — no celebratory burst). No new geometry, no fake audio.
 */
const bridgeStateForPhase: Record<ActivityPhase, 'idle' | 'connecting' | 'arrived'> = { QUEUED: 'idle', IN_PROGRESS: 'connecting', FINALIZING: 'arrived' };
function ProviderActivity({ phase, startedAt }: Readonly<{ phase: ActivityPhase; startedAt: string | null | undefined }>) {
  const elapsed = useElapsedSeconds(startedAt, true);
  const copy = activityCopy[phase];
  return <div className="acq-provider-activity" role="status" aria-live="polite"><div className="acq-signal-instrument"><SignalBridge state={bridgeStateForPhase[phase]} /></div><strong>{copy.title}</strong><p>{copy.body}</p>{elapsed === null ? null : <span className="acq-activity-elapsed">Elapsed {transcriptOffset(elapsed)}</span>}{copy.footer === null ? null : <small>{copy.footer}</small>}</div>;
}
function HostedWarningModal({ busy, onCancel, onConfirm }: Readonly<{ busy: boolean; onCancel: () => void; onConfirm: () => void }>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onCancel(); return; }
      if (event.key !== 'Tab' || dialogRef.current === null) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button');
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
  return <div className="acq-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><div className="acq-modal" role="dialog" aria-modal="true" aria-labelledby="hosted-modal-title" ref={dialogRef}>
    <p className="acq-eyebrow">Hosted live demo</p>
    <h2 id="hosted-modal-title">This is a synthetic CALL-E demonstration</h2>
    <p>Exception Broker will contact the configured CALL-E testing destination. No real customer is contacted.</p>
    <p>A live acquisition may take approximately 2–10 minutes, including provider finalization.</p>
    <p><strong>Keep this tab open while the acquisition is active.</strong></p>
    <div className="acq-modal-actions"><button type="button" className="acq-modal-cancel" onClick={onCancel}>Cancel</button><button type="button" className="acq-modal-confirm" ref={confirmRef} disabled={busy} onClick={onConfirm}>{busy ? <Activity label="Starting hosted demo…" /> : <>Start hosted demo <Arrow /></>}</button></div>
  </div></div>;
}
function AcquisitionRail({ steps, connectionKind, connected, used, connectionLocked, onConfigure }: Readonly<{ steps: readonly FlowStep[]; connectionKind: AcquisitionConnectionKind | null; connected: boolean; used: boolean; connectionLocked: boolean; onConfigure: () => void }>) {
  const status = connectionKind === 'HOSTED_DEMO' ? (used ? 'Hosted demo used for this browser session' : 'Hosted demo connected') : 'Your CALL-E account is connected for this session';
  return <aside className="acq-rail" aria-label="Acquisition flow"><div className="acq-rail-top"><p>Acquisition flow</p><ol>{steps.map((step, index) => <li className={`acq-rail-step is-${step.tone}`} key={step.label}><span aria-hidden="true">{step.tone === 'done' ? <IconCheck /> : index + 1}</span><div><strong>{step.label}</strong><small>{step.state}</small></div></li>)}</ol>{connected ? <div className="acq-rail-access"><b><i aria-hidden="true" /> CALL-E connection</b><span>connected</span><p>{status}</p><button type="button" disabled={connectionLocked} onClick={onConfigure}>Disconnect CALL-E</button>{connectionLocked ? <small>Connection locked while this acquisition is active.</small> : <small>Connected for this browser session.</small>}</div> : null}</div><div className="acq-rail-scene" aria-hidden="true"><div className="acq-rail-motif"><q>Higher ground is a choice.</q><span>— The Sentinel</span></div></div></aside>;
}
/**
 * The Exception Broker <-> provider signal bridge. Decorative, but never decorative-perpetual:
 * `idle` rests (one very slow luminance breath, no travelling signal), `connecting` only runs
 * while a real connection request is in flight, and `arrived` plays one settling pulse.
 * Written to be reusable for later Broker stages (evidence, decision, control gate).
 */
function SignalBridge({ state = 'idle' }: Readonly<{ state?: 'idle' | 'connecting' | 'arrived' }> = {}) {
  // Braided strands: bunched at the Broker end, fanned through the middle, converging into the
  // provider node. Amplitude and opacity vary per strand so the ribbon reads as depth, not noise.
  const strands: readonly Readonly<{ d: string; width: number; opacity: number }>[] = [
    { d: 'M4,96 C140,94 196,30 336,28 C470,26 546,78 636,90', width: 1.1, opacity: 0.45 },
    { d: 'M4,96 C148,95 200,52 336,50 C466,48 548,84 636,92', width: 1.5, opacity: 0.6 },
    { d: 'M4,96 C152,96 206,74 336,72 C462,70 550,88 636,93', width: 2.1, opacity: 0.8 },
    { d: 'M4,96 C156,96 212,96 336,96 C458,96 552,95 636,95', width: 2.6, opacity: 1 },
    { d: 'M4,96 C152,96 206,118 336,120 C462,122 550,104 636,97', width: 2.1, opacity: 0.8 },
    { d: 'M4,96 C148,97 200,140 336,142 C466,144 548,108 636,99', width: 1.5, opacity: 0.6 },
    { d: 'M4,96 C140,98 196,162 336,164 C470,166 546,114 636,101', width: 1.1, opacity: 0.45 },
  ];
  return <svg className={`acq-bridge is-${state}`} viewBox="0 0 640 192" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="acq-bridge-flow" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--acq-plum)" stopOpacity="0" />
        <stop offset="12%" stopColor="var(--acq-plum)" stopOpacity=".75" />
        <stop offset="46%" stopColor="var(--acq-bridge-mid)" stopOpacity=".8" />
        <stop offset="78%" stopColor="var(--acq-calle)" stopOpacity="1" />
        <stop offset="97%" stopColor="var(--acq-calle)" stopOpacity=".85" />
        <stop offset="100%" stopColor="var(--acq-calle)" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="acq-bridge-halo">
        <stop offset="0%" stopColor="var(--acq-calle)" stopOpacity=".5" />
        <stop offset="55%" stopColor="var(--acq-calle)" stopOpacity=".12" />
        <stop offset="100%" stopColor="var(--acq-calle)" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="acq-bridge-origin">
        <stop offset="0%" stopColor="var(--acq-plum)" stopOpacity=".34" />
        <stop offset="100%" stopColor="var(--acq-plum)" stopOpacity="0" />
      </radialGradient>
      <filter id="acq-bridge-bloom" x="-10%" y="-60%" width="120%" height="220%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
    <circle className="acq-bridge-origin" cx="26" cy="96" r="60" fill="url(#acq-bridge-origin)" />
    <circle className="acq-bridge-halo" cx="614" cy="96" r="66" fill="url(#acq-bridge-halo)" />
    <g className="acq-bridge-bloom" stroke="url(#acq-bridge-flow)" fill="none" strokeLinecap="round" filter="url(#acq-bridge-bloom)" opacity=".55">
      {strands.map((strand) => <path key={`bloom-${strand.d}`} d={strand.d} strokeWidth={strand.width * 1.8} opacity={strand.opacity} />)}
    </g>
    <g className="acq-bridge-strands" stroke="url(#acq-bridge-flow)" fill="none" strokeLinecap="round">
      {strands.map((strand) => <path key={strand.d} d={strand.d} strokeWidth={strand.width} opacity={strand.opacity} />)}
    </g>
    <g className="acq-bridge-points" fill="var(--acq-calle)">
      <circle cx="336" cy="96" r="2.6" opacity=".75" />
      <circle cx="452" cy="95" r="2" opacity=".6" />
      <circle cx="556" cy="95" r="2.8" opacity=".9" />
    </g>
    <path className="acq-bridge-pulse" d={strands[3]!.d} fill="none" stroke="var(--acq-calle)" strokeWidth="3" strokeLinecap="round" pathLength={100} />
  </svg>;
}

/**
 * The Connection Gate: disconnected-only presentation. One composition — Exception Broker,
 * a living signal bridge and the real CALL-E provider identity — followed by the two live
 * routes and a tertiary path to the existing guided demo. Functional behavior
 * (connectHosted/connectByok, field names, disabled/busy handling) is unchanged.
 */
function ConnectionGate({ busy, message, storedId, onConnectHosted, onConnectByok, onTryDemo }: Readonly<{
  busy: boolean;
  message: string;
  storedId: string | null;
  onConnectHosted: () => void;
  onConnectByok: (event: React.FormEvent<HTMLFormElement>) => void;
  onTryDemo: () => void;
}>) {
  return <section className="acq-gate" aria-labelledby="unlock-title">
    <header className="acq-gate-head">
      <div>
        <p className="acq-eyebrow">Acquisition</p>
        <h1 id="unlock-title">Connect to CALL-E</h1>
        <p className="acq-gate-lede">Choose how to run a live voice acquisition. Same control path. Two ways to connect.</p>
      </div>
      <p className="acq-gate-marker" aria-hidden="true">Intelligence<br />in motion</p>
    </header>
    {storedId ? <p className="acq-gate-recovery"><strong>Previous acquisition saved.</strong> Reconnect to check its latest status.</p> : null}
    <div className="acq-gate-hero">
      <div className="acq-gate-party acq-gate-party--broker">
        <img src={productLogo} alt="" width="56" height="40" />
        <span><b>Exception Broker</b><small>Secure decision making</small></span>
      </div>
      <SignalBridge state={busy ? 'connecting' : 'idle'} />
      <div className="acq-gate-party acq-gate-party--calle">
        <span className="acq-gate-calle-node"><img src={calleIcon} alt="CALL-E" width="44" height="47" /></span>
        <span><b>CALL-E</b><small>Voice AI for real conversations</small></span>
      </div>
    </div>
    <div className="acq-gate-routes">
      <article className="acq-gate-route acq-gate-route--byok">
        <header><span className="acq-gate-route-mark" aria-hidden="true"><IconCall /></span><p className="acq-gate-descriptor">For live acquisitions</p><h2>Your CALL-E account</h2></header>
        <p>Run the live controlled Acquisition with your own provider account and an authorized recipient.</p>
        <ul>
          <li>Your CALL-E account and balance</li>
          <li>Your authorized recipient</li>
          <li>Same Exception Broker control path</li>
        </ul>
        <form onSubmit={onConnectByok}>
          <label>CALL-E API key<input name="calleApiKey" type="password" autoComplete="off" placeholder="sk-…" /></label>
          <button type="submit" disabled={busy}>{busy ? <Activity label="Connecting CALL-E…" /> : <>Connect your account <Arrow /></>}</button>
        </form>
        <small>The key is attached only in ephemeral server memory for this connection.</small>
      </article>
      <article className="acq-gate-route acq-gate-route--hosted">
        <header><p className="acq-gate-descriptor">Limited live test</p><h2>Hosted sandbox</h2><img className="acq-gate-provider-mark" src={calleLogo} alt="CALL-E" width="92" height="37" /></header>
        <p>Verify the live CALL-E integration using Exception Broker's limited managed connection.</p>
        <ul>
          <li>No CALL-E account required</li>
          <li>Synthetic CALL-E testing destination</li>
          <li>Outcomes are not scripted</li>
        </ul>
        <button type="button" disabled={busy} onClick={onConnectHosted}>{busy ? <Activity label="Connecting CALL-E…" /> : <>Use hosted sandbox <Arrow /></>}</button>
        <small>Uses Exception Broker's limited hosted budget · one acquisition per browser session.</small>
      </article>
    </div>
    <footer className="acq-gate-foot">
      <p>Exception Broker evaluates whatever CALL-E actually returns — including a safe stop.</p>
      <p className="acq-gate-escape">No provider setup or live call needed? <button type="button" onClick={onTryDemo}>Try the guided demo <Arrow /></button></p>
    </footer>
    <p className="acquisition-announcement" aria-live="polite" aria-atomic="true">{message}</p>
  </section>;
}
function FormationStep({ number, title, detail, state, tone }: Readonly<{ number: number; title: string; detail: string; state: string; tone: string }>) { return <li className={`is-${tone}`}><span>{number}</span><div><strong>{title}</strong><small>{detail}</small><b className="acq-state">{state}</b></div></li>; }

const failureStageLabel: Record<AcquisitionTechnicalFailure['stage'], string> = {
  CREATE: 'Starting the call with CALL-E',
  PROVIDER_TERMINAL: 'The CALL-E call itself',
};
/** Plain language for what can actually be proven. Never claims more certainty than the server established. */
const acceptanceLabel: Record<AcquisitionTechnicalFailure['acceptance'], string> = {
  DEFINITELY_NOT_SENT: 'No request reached CALL-E',
  UNKNOWN: 'Unknown — the request may have reached CALL-E',
  PROVIDER_IDENTIFIED: 'CALL-E accepted the call and returned its identity',
};
/**
 * Collapsed by default: the hero stays human and the diagnostics stay one click away.
 * Records written before diagnostics existed say so rather than inventing a cause.
 */
function TechnicalDetails({ detail }: Readonly<{ detail: AcquisitionTechnicalFailure | undefined }>) {
  return <details className="acq-technical-details">
    <summary>Technical details</summary>
    {detail === undefined
      ? <p>Technical cause unavailable for this earlier record.</p>
      : <dl>
        <div><dt>Stage</dt><dd>{failureStageLabel[detail.stage]}</dd></div>
        <div><dt>Provider acceptance</dt><dd>{acceptanceLabel[detail.acceptance]}</dd></div>
        {detail.code === null ? null : <div><dt>Provider code</dt><dd>{detail.code}</dd></div>}
        {detail.message === null ? null : <div><dt>Provider message</dt><dd>{detail.message}</dd></div>}
        <div><dt>Safe reconciliation</dt><dd>{detail.reconciliationAvailable ? 'Available for this acquisition' : 'Not applicable'}</dd></div>
      </dl>}
  </details>;
}

export const AcquisitionExperience = ({ api, onNavigateControl, onNavigateHome, createIdentity = () => crypto.randomUUID(), clock = () => new Date().toISOString(), onOpenControl }: ExperienceProps) => {
  const [accessToken, setAccessToken] = useState(() => readStorage(sessionStorage, acquisitionAccessKey));
  const [connectionKind, setConnectionKind] = useState<AcquisitionConnectionKind | null>(() => readStorage(sessionStorage, acquisitionAccessKindKey) === 'BYOK' ? 'BYOK' : readStorage(sessionStorage, acquisitionAccessKey) === null ? null : 'HOSTED_DEMO');
  const [connectionReady, setConnectionReady] = useState(false);
  const [storedId, setStoredId] = useState(() => readStorage(localStorage, acquisitionStorageKey));
  const [record, setRecord] = useState<AcquisitionPublicRecord | null>(null);
  const [recoveryClearAllowed, setRecoveryClearAllowed] = useState(false);
  const [phone, setPhone] = useState(''); const [authorized, setAuthorized] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [refreshCount, setRefreshCount] = useState(0); const [monitoringError, setMonitoringError] = useState(false); const [explicitRefreshPending, setExplicitRefreshPending] = useState(false); const [handoffPending, setHandoffPending] = useState(false);
  const [hostedModalOpen, setHostedModalOpen] = useState(false); const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const createPending = useRef(false); const explicitRefreshLock = useRef(false); const activeAcquisitionId = useRef<string | null>(record?.acquisitionId ?? null);
  /** The exact content already submitted, so an in-session reconciliation re-sends it unchanged. */
  const lastCreateInput = useRef<BrowserAcquisitionCreateInput | null>(null);
  activeAcquisitionId.current = record?.acquisitionId ?? null;
  const terminal = record === null ? false : createAcquisitionPresentation(record).terminal;
  useEffect(() => { if (accessToken === null) { setConnectionReady(false); return; } let mounted = true; setBusy(true); void api.getConnection(accessToken).then(async (connection) => { if (!mounted) return; setConnectionKind(connection.kind); writeStorage(sessionStorage, acquisitionAccessKindKey, connection.kind); try { const owned = storedId === null ? await api.getActive(accessToken) : null; if (!mounted) return; if (owned !== null) { writeStorage(localStorage, acquisitionStorageKey, owned.acquisitionId); setStoredId(owned.acquisitionId); setRecord(owned); activeAcquisitionId.current = owned.acquisitionId; setMessage('Your previous acquisition was restored.'); } setConnectionReady(true); } catch { if (mounted) setMessage('The CALL-E connection is retained, but active acquisition state could not be verified. Reload to retry safely.'); } }).catch(() => { if (!mounted) return; removeStorage(sessionStorage, acquisitionAccessKey); removeStorage(sessionStorage, acquisitionAccessKindKey); setAccessToken(null); setConnectionKind(null); setConnectionReady(false); setMessage('The CALL-E connection expired. Re-establish it to continue.'); }).finally(() => { if (mounted) setBusy(false); }); return () => { mounted = false; }; }, [accessToken, api]);
  useEffect(() => { if (!connectionReady || accessToken === null || storedId === null || record !== null) return; let active = true; setBusy(true); setRecoveryClearAllowed(false); void api.get(storedId, accessToken).then((restored) => { if (!active) return; activeAcquisitionId.current = restored.acquisitionId; setRecord(restored); setMessage('Your acquisition was restored.'); setRefreshCount(0); setMonitoringError(false); }).catch(async () => { if (!active) return; try { const owned = await api.getActive(accessToken); if (!active) return; if (owned !== null) { writeStorage(localStorage, acquisitionStorageKey, owned.acquisitionId); setStoredId(owned.acquisitionId); setRecord(owned); activeAcquisitionId.current = owned.acquisitionId; setMessage('Your previous acquisition was restored.'); } else { setRecoveryClearAllowed(true); setMessage('Acquisition could not be restored, and no active acquisition belongs to this connection.'); } } catch { if (active) setMessage('Recovery could not be verified. Your connection and previous acquisition are kept safely.'); } }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [connectionReady, accessToken, api, record, storedId]);
  useEffect(() => { if (accessToken === null || record === null || terminal || refreshCount >= maxRefreshes) return undefined; let active = true; const acquisitionId = record.acquisitionId; const timer = window.setTimeout(() => { void api.refresh(acquisitionId, accessToken).then((result) => { if (!active || activeAcquisitionId.current !== acquisitionId || result.record.acquisitionId !== acquisitionId) return; setRecord(result.record); setRefreshCount((count) => count + 1); setMonitoringError(false); setMessage(''); }).catch((error: unknown) => { if (!active || activeAcquisitionId.current !== acquisitionId) return; setMessage(errorMessage(error)); setMonitoringError(true); setRefreshCount(maxRefreshes); }); }, refreshDelayMs(refreshCount)); return () => { active = false; window.clearTimeout(timer); }; }, [accessToken, api, record, refreshCount, terminal]);
  const retainConnection = (connection: Readonly<{ connectionId: string; kind: AcquisitionConnectionKind }>) => { writeStorage(sessionStorage, acquisitionAccessKey, connection.connectionId); writeStorage(sessionStorage, acquisitionAccessKindKey, connection.kind); if (connection.kind === 'HOSTED_DEMO') writeStorage(sessionStorage, acquisitionHostedSessionKey, connection.connectionId); setAccessToken(connection.connectionId); setConnectionKind(connection.kind); setConnectionReady(false); setMessage(storedId ? 'CALL-E connected. Restoring your previous acquisition.' : 'CALL-E connected for this browser session.'); };
  const connectHosted = async () => { setBusy(true); try { retainConnection(await api.connectHosted(readStorage(sessionStorage, acquisitionHostedSessionKey) ?? undefined)); } catch (error: unknown) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  const connectByok = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const apiKey = new FormData(form).get('calleApiKey'); if (typeof apiKey !== 'string' || apiKey.trim() === '') { setMessage('Enter a CALL-E API key.'); return; } setBusy(true); try { retainConnection(await api.connectByok(apiKey)); form.reset(); } catch (error: unknown) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  const lock = async () => { if (busy || (record !== null && !isTerminalStatus(record.status))) return; setBusy(true); try { if (accessToken !== null && connectionKind === 'BYOK') await api.disconnect(accessToken); removeStorage(sessionStorage, acquisitionAccessKey); removeStorage(sessionStorage, acquisitionAccessKindKey); activeAcquisitionId.current = null; setAccessToken(null); setConnectionKind(null); setConnectionReady(false); setRecord(null); setMessage(storedId ? 'CALL-E disconnected. Your previous acquisition is saved.' : 'CALL-E disconnected.'); } catch (error: unknown) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  const reset = () => { if (record !== null && !isTerminalStatus(record.status)) return; removeStorage(localStorage, acquisitionStorageKey); activeAcquisitionId.current = null; setStoredId(null); setRecord(null); setRecoveryClearAllowed(false); setRefreshCount(0); setMonitoringError(false); setMessage('Previous session cleared.'); };
  const refreshStatus = async () => { if (accessToken === null || record === null || terminal || refreshCount < maxRefreshes || explicitRefreshLock.current) return; const acquisitionId = record.acquisitionId; explicitRefreshLock.current = true; setExplicitRefreshPending(true); setMessage('Checking the latest status…'); try { const result = await api.refresh(acquisitionId, accessToken); if (activeAcquisitionId.current !== acquisitionId || result.record.acquisitionId !== acquisitionId) return; setRecord(result.record); setMonitoringError(false); setMessage('Latest status checked.'); } catch (error: unknown) { if (activeAcquisitionId.current === acquisitionId) setMessage(errorMessage(error)); } finally { explicitRefreshLock.current = false; setExplicitRefreshPending(false); } };
  const submitCreate = async (request: BrowserAcquisitionCreateInput, notice: string, settled: string) => { if (accessToken === null || !connectionReady || createPending.current) return; createPending.current = true; lastCreateInput.current = request; setBusy(true); setMessage(notice); try { const result = await api.create(request, accessToken); writeStorage(localStorage, acquisitionStorageKey, result.record.acquisitionId); activeAcquisitionId.current = result.record.acquisitionId; setStoredId(result.record.acquisitionId); setRecord(result.record); setRefreshCount(0); setMonitoringError(false); setPhone(''); setAuthorized(false); setMessage(settled); } catch (error: unknown) { if (error instanceof AcquisitionApiError && error.code === 'ACTIVE_ACQUISITION_EXISTS') { try { const owned = await api.getActive(accessToken); if (owned !== null) { writeStorage(localStorage, acquisitionStorageKey, owned.acquisitionId); setStoredId(owned.acquisitionId); setRecord(owned); activeAcquisitionId.current = owned.acquisitionId; setMessage('Your previous acquisition was restored.'); return; } } catch { /* Preserve the original safe failure. */ } } setMessage(errorMessage(error)); } finally { createPending.current = false; setBusy(false); } };
  const performCreate = () => submitCreate(createBrowserAcquisitionRequest({ identity: createIdentity(), createdAt: clock(), ...(connectionKind === 'BYOK' ? { phoneNumber: phone } : {}) }), 'Creating one controlled CALL-E acquisition…', 'Acquisition accepted. Watching for updates.');
  /** Same acquisition, same server-held idempotency key: this can only resolve the original request, never place a second call. */
  const reconcile = () => { if (reconcileInput === null) return; void submitCreate(reconcileInput, 'Checking with CALL-E using the same acquisition…', 'Reconciliation checked with CALL-E.'); };
  /** The server re-derives the fingerprint from the re-entered recipient and rejects a mismatch before contacting CALL-E. */
  const reconcileByok = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (record === null) return;
    if (!phonePattern.test(phone)) { setMessage('Enter the same recipient number used for this acquisition, including the country code.'); return; }
    if (!authorized) { setMessage('Confirm recipient ownership or authorization before reconciling.'); return; }
    const rebuilt = reconcileBrowserAcquisitionRequest(record, phone);
    if (rebuilt === null) { setMessage('This acquisition cannot be reconciled from this browser.'); return; }
    void submitCreate(rebuilt, 'Checking with CALL-E using the same acquisition…', 'Reconciliation checked with CALL-E.');
  };
  /** A deliberate new live call after a provider-confirmed technical failure. The server re-verifies the one Hosted allowance. */
  const retryHostedTest = () => { if (record === null) return; void submitCreate({ ...createBrowserAcquisitionRequest({ identity: createIdentity(), createdAt: clock() }), recoveryOfAcquisitionId: record.acquisitionId }, 'Starting one recovery hosted test…', 'Recovery acquisition accepted. Watching for updates.'); };
  const create = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (accessToken === null || !connectionReady || createPending.current) return; if (connectionKind === 'HOSTED_DEMO') { setHostedModalOpen(true); return; } if (!phonePattern.test(phone)) { setMessage('Enter a full phone number, including the country code.'); return; } if (!authorized) { setMessage('Confirm recipient ownership or authorization before starting.'); return; } void performCreate(); };
  const confirmHostedDemo = () => { setHostedModalOpen(false); void performCreate(); };
  const continueToControl = async () => { if (accessToken === null || record === null || !ready || handoffPending) return; setHandoffPending(true); setMessage('Resolving controlled context and exact review on the server…'); try { const result = await api.handoff(record.acquisitionId, accessToken); onOpenControl?.(result.record); } catch (error: unknown) { setMessage(errorMessage(error)); } finally { setHandoffPending(false); } };

  const presentation = record === null ? null : createAcquisitionPresentation(record); const provider = record?.providerEvidence; const attempt = record ? latestAttempt(record) : undefined;
  const safeStop = record?.status === 'completed' && (record.normalizationStatus === 'SAFE_STOP' || record.handoffState === 'SAFE_STOP');
  const ready = record?.status === 'completed' && record.normalizationStatus === 'USABLE' && record.handoffState === 'READY_FOR_REVIEW';
  const transcript = provider?.recipients.flatMap((recipient) => recipient.attempts.flatMap((item) => item.transcriptTurns)) ?? [];
  const failed = presentation?.lifecycle === 'FAILED' || presentation?.lifecycle === 'CANCELED'; const active = Boolean(record && presentation && !terminal);
  const evidenceAvailable = Boolean(provider && provider.evidence.length > 0);
  const connected = connectionReady && connectionKind !== null;
  const flowSteps: readonly FlowStep[] = !connected ? [{ label: 'Conversation', state: 'CONNECTION REQUIRED', tone: 'active' }, { label: 'Evidence', state: 'WAITING', tone: 'waiting' }, { label: 'Decision', state: 'WAITING', tone: 'waiting' }, { label: 'Control', state: 'LOCKED', tone: 'locked' }] : record === null ? [{ label: 'Conversation', state: 'READY', tone: 'active' }, { label: 'Evidence', state: 'WAITING', tone: 'waiting' }, { label: 'Decision', state: 'WAITING', tone: 'waiting' }, { label: 'Control', state: 'LOCKED', tone: 'locked' }] : ready ? [{ label: 'Conversation', state: 'CAPTURED', tone: 'done' }, { label: 'Evidence', state: evidenceAvailable ? 'AVAILABLE' : 'NOT AVAILABLE', tone: evidenceAvailable ? 'done' : 'waiting' }, { label: 'Decision', state: 'FORMED', tone: 'done' }, { label: 'Control', state: 'NEXT', tone: 'active' }] : safeStop ? [{ label: 'Conversation', state: 'CAPTURED', tone: 'done' }, { label: 'Evidence', state: evidenceAvailable ? 'AVAILABLE' : 'NOT AVAILABLE', tone: evidenceAvailable ? 'done' : 'stopped' }, { label: 'Decision', state: 'NO USABLE DECISION', tone: 'stopped' }, { label: 'Control', state: 'LOCKED', tone: 'locked' }] : failed ? [{ label: 'Conversation', state: presentation.lifecycle, tone: 'stopped' }, { label: 'Evidence', state: evidenceAvailable ? 'AVAILABLE' : 'NOT AVAILABLE', tone: evidenceAvailable ? 'done' : 'waiting' }, { label: 'Decision', state: 'NOT FORMED', tone: 'stopped' }, { label: 'Control', state: 'LOCKED', tone: 'locked' }] : record.technicalFailure?.stage === 'CREATE' && record.technicalFailure.acceptance === 'UNKNOWN' ? [{ label: 'Conversation', state: 'ACCEPTANCE UNKNOWN', tone: 'stopped' }, { label: 'Evidence', state: 'WAITING', tone: 'waiting' }, { label: 'Decision', state: 'NOT FORMED', tone: 'stopped' }, { label: 'Control', state: 'LOCKED', tone: 'locked' }]
    : [{ label: 'Conversation', state: presentation?.lifecycle === 'IN_PROGRESS' ? 'IN PROGRESS' : presentation?.lifecycle ?? 'STARTING', tone: 'active' }, { label: 'Evidence', state: evidenceAvailable ? 'AVAILABLE' : 'WAITING', tone: evidenceAvailable ? 'done' : 'waiting' }, { label: 'Decision', state: 'WAITING', tone: 'waiting' }, { label: 'Control', state: 'LOCKED', tone: 'locked' }];
  const incompleteAcquiredDecision = safeStop && provider?.structuredResult !== null && provider?.taskCompleted !== true && record.safeStopReason === 'taskCompleted contradicts the structured decision';
  const clarificationRequired = safeStop && provider?.taskCompleted === true && provider.structuredResult?.decision === 'NEEDS_CLARIFICATION';
  const technical = record?.technicalFailure;
  /** Ambiguous create: never terminal and never a provider outcome, whether or not retries remain. */
  const acceptanceUnknown = Boolean(record && !terminal && technical?.stage === 'CREATE' && technical.acceptance === 'UNKNOWN');
  /** The server spent its lifetime dispatch budget: the acquisition stays protected, but nothing may dial again. */
  const reconcileExhausted = acceptanceUnknown && technical?.reconciliationAvailable === false;
  const reconcileInput = record === null || !acceptanceUnknown || reconcileExhausted
    ? null
    : lastCreateInput.current?.acquisitionId === record.acquisitionId ? lastCreateInput.current : reconcileBrowserAcquisitionRequest(record);
  /** BYOK never stores the full recipient, so after a reload the operator re-enters it to rebuild the same request. */
  const byokReconcileNeeded = Boolean(record && acceptanceUnknown && !reconcileExhausted && reconcileInput === null && record.accessMode !== 'HOSTED_DEMO');
  const interactionTitle = reconcileExhausted ? 'CALL-E acceptance is still unresolved'
    : acceptanceUnknown ? 'Acquisition needs reconciliation'
      : ready || safeStop ? 'Call completed'
        : failed ? "CALL-E couldn't complete this acquisition"
          : presentation?.label ?? '';
  /** One explicit Hosted redial, offered only for a provider-confirmed terminal technical failure. */
  const hostedRecoveryAvailable = Boolean(record && failed && record.status === 'failed' && record.accessMode === 'HOSTED_DEMO'
    && technical?.acceptance === 'PROVIDER_IDENTIFIED' && record.recoveredByAcquisitionId === undefined);
  const startedAt = attempt?.startedAt ?? provider?.createdAt ?? record?.createdAt; const completedAt = attempt?.completedAt ?? provider?.completedAt; const duration = durationBetween(startedAt, completedAt);
  const finalizing = active && attempt?.status === 'completed';
  const activityPhase: ActivityPhase = finalizing ? 'FINALIZING' : presentation?.lifecycle === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'QUEUED';
  const previewTurns = transcript.slice(0, 4); const remainingTurns = transcript.slice(4);
  const previewGroups = groupBySpeaker(previewTurns.map((turn, index) => ({ turn, index })));
  const remainingGroups = groupBySpeaker(remainingTurns.map((turn, index) => ({ turn, index: index + 4 })));
  useEffect(() => { setTranscriptExpanded(false); }, [record?.acquisitionId]);

  return <div className="acquisition-shell"><header className="acq-topbar"><button className="acq-logo-link" type="button" onClick={onNavigateHome} aria-label="Exception Broker home"><AcquisitionBrand /></button><nav className="acq-nav" aria-label="Product">{onNavigateHome ? <button type="button" onClick={onNavigateHome}>Home</button> : null}<button type="button" aria-current="page">Acquisition</button><button type="button" onClick={onNavigateControl}>Control</button></nav><div className="acq-topbar-actions"><button type="button" className="acq-demo" onClick={onNavigateControl}>Try demo <Arrow /></button><ThemeControl /></div></header><main className="acq-page">
    <div className="acq-layout"><AcquisitionRail steps={flowSteps} connectionKind={connectionKind} connected={connected} used={record !== null || storedId !== null} connectionLocked={active} onConfigure={() => void lock()} /><div className={`acq-main${accessToken === null || connectionKind === null ? ' is-gate' : ''}`}>
      {accessToken === null || connectionKind === null ? <ConnectionGate busy={busy} message={message} storedId={storedId} onConnectHosted={() => void connectHosted()} onConnectByok={connectByok} onTryDemo={onNavigateControl} /> : null}
      {accessToken !== null && connectionKind !== null && !connectionReady ? <section className="acq-access acq-recovery acq-verify" aria-label="Connection verification"><div className="acq-verify-bridge"><SignalBridge state="arrived" /></div><h1>Verifying CALL-E connection</h1>{busy ? <Activity label="Checking connection and active acquisition…" /> : <p>{message}</p>}<p>We're keeping your connection while we check its status.</p></section> : null}
      {connectionReady && connectionKind !== null ? <>
      {record === null && storedId === null ? <><header className="acq-interaction-band"><div><p className="acq-eyebrow">CALL-E interaction <span className="acq-inline-status is-ready">● READY</span></p><h1 className="acq-title-shift">Acquire a decision</h1><p>Prepare a controlled interaction before any conversation begins.</p></div><dl><div><dt>Provider</dt><dd>CALL-E</dd></div><div><dt>Recipient</dt><dd>{connectionKind === 'HOSTED_DEMO' ? 'Hosted synthetic destination' : (phone || 'Not entered')}</dd></div><div><dt>Mode</dt><dd>Controlled call</dd></div><div><dt>Record</dt><dd>Not created</dd></div></dl></header><div className="acq-ready-grid"><section className="acq-panel acq-preparation" aria-labelledby="new-acquisition-title"><header><span className="acq-panel-icon" aria-hidden="true"><IconCall /></span><div><h2 id="new-acquisition-title">Controlled acquisition</h2><p>Confirm the brief before CALL-E starts.</p></div><small>PRE-CALL</small></header><form id="acquisition-create" onSubmit={create}>
        <div className="acq-prep-row"><b>Recipient</b><div>{connectionKind === 'HOSTED_DEMO' ? <><strong>Hosted synthetic destination</strong><small>Configured by Exception Broker. No real customer is contacted.</small></> : <><label className="acq-phone-label" htmlFor="acquisition-recipient-phone">Recipient phone<input id="acquisition-recipient-phone" name="recipientPhone" aria-label="Recipient phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(normalizePhoneInput(event.target.value))} placeholder="+15551234567" /></label><small>Include the country code. Spaces, hyphens and parentheses are removed automatically.</small></>}</div></div><div className="acq-prep-row"><b>Objective</b><div><strong>Capture the Client decision for the controlled recovery plan.</strong><details><summary>View full definition</summary><p>{ACQUISITION_V1_OBJECTIVE}</p></details></div></div><div className="acq-prep-row"><b>Context</b><div><strong>Controlled sandbox recovery context</strong><details><summary>Inspect full context</summary><p>{ACQUISITION_V1_CONTEXT}</p></details></div></div><div className="acq-prep-row"><b>Authorization</b><div>{connectionKind === 'HOSTED_DEMO' ? <><strong>Confirmed before CALL-E is contacted</strong><small>Starting opens one explicit confirmation before any call begins.</small></> : <label className="authorization-check" htmlFor="acquisition-recipient-authorization"><input id="acquisition-recipient-authorization" name="authorizationConfirmed" type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span>I confirm I own or am authorized to call this recipient.<small>No call begins until this confirmation is recorded.</small></span></label>}</div></div>
      </form></section><section className="acq-panel acq-waiting-panel" aria-label="What happens next"><header><span className="acq-panel-icon" aria-hidden="true"><IconEvidence /></span><div><h2>Provider evidence</h2><p>Available after the interaction.</p></div></header><div className="acq-waiting"><span aria-hidden="true"><IconEvidence /></span><div><strong>Awaiting provider evidence</strong><small>No extracted evidence items exist before a call begins.</small></div><b>WAITING</b></div><div className="acq-ready-formation"><h2>Decision formation</h2><p>Nothing formed yet.</p><div className="acq-waiting"><span aria-hidden="true"><IconDecision /></span><div><strong>Awaiting provider result</strong><small>No structured result or normalization result yet.</small></div><b>WAITING</b></div><small>Control eligibility remains locked.</small></div></section></div><section className="acq-resolution is-pending" aria-label="Decision status"><div className="acq-resolution-mark" aria-hidden="true"><IconCall /></div><div><p className="acq-eyebrow">Acquisition ready</p><h2>Start when ready</h2><p>CALL-E · Controlled acquisition</p></div><div className="acq-resolution-copy"><strong>A conversation has not started.</strong><span>Starting the controlled call creates the conversation record. Evidence and decision formation remain unavailable until information is captured.</span><small>✓ Brief confirmed &nbsp; ✓ Recipient authorization required &nbsp; ○ Control locked</small></div><div className="acq-resolution-action"><button type="submit" form="acquisition-create" disabled={busy}>{busy ? 'Starting…' : 'Start CALL-E acquisition'} <Arrow /></button><small>{connectionKind === 'HOSTED_DEMO' ? 'Opens one explicit confirmation first' : 'Confirm authorization to enable'}</small></div></section></> : null}
      {record === null && storedId !== null ? <section className="acq-access acq-recovery" aria-label="Acquisition recovery unavailable"><h1>Previous acquisition unavailable</h1><p>{message || 'Acquisition could not be restored with the current live-access session.'}</p><p>We'll keep it saved until we can confirm from this connection whether it's still active.</p><button type="button" disabled={!recoveryClearAllowed} onClick={reset}>{recoveryClearAllowed ? 'Clear previous session' : 'Checking before we can clear it…'}</button></section> : null}
      {record && presentation ? <><header className="acq-interaction-band"><div><p className="acq-eyebrow">CALL-E interaction <span className={`acq-inline-status is-${failed ? 'failed' : ready ? 'complete' : safeStop || acceptanceUnknown ? 'stopped' : 'active'}`}>● {acceptanceUnknown ? 'ACCEPTANCE UNKNOWN' : presentation.lifecycle}</span></p><h1 key={interactionTitle} className="acq-title-shift">{interactionTitle}</h1><p>{reconcileExhausted ? 'Exception Broker is retaining this acquisition because CALL-E may have accepted an earlier request. No additional call will be started automatically.' : acceptanceUnknown ? 'CALL-E may or may not have received this request. Nothing is retried automatically.' : failed ? 'No decision was formed. No Control handoff or external execution occurred.' : active ? 'Conversation evidence appears only as the provider returns it.' : ready ? 'A usable structured decision is available for exact review.' : clarificationRequired ? 'The completed acquisition requires clarification before a reviewable decision can exist.' : safeStop ? 'The provider completed, but no usable decision was established.' : 'The provider interaction ended without a reviewable decision.'}</p></div><dl><div><dt>Provider</dt><dd>CALL-E</dd></div><div><dt>Recipient</dt><dd>{record.maskedRecipient}</dd></div>{duration ? <div><dt>Duration</dt><dd>{duration}</dd></div> : null}<div><dt>Started</dt><dd>{formatTime(startedAt) ?? 'Not available'}</dd></div>{completedAt ? <div><dt>Completed</dt><dd>{formatTime(completedAt)}</dd></div> : null}<div><dt>Attempt</dt><dd>{attempt?.status ?? record.status}</dd></div></dl></header><div className="acq-document-grid"><section className="acq-panel acq-conversation" aria-labelledby="conversation-title"><header><span className="acq-panel-icon" aria-hidden="true"><IconWaveform /></span><div><h2 id="conversation-title">{active ? 'Conversation evidence' : 'Conversation'}</h2><p>{transcript.length} {transcript.length === 1 ? 'turn' : 'turns'} returned by the provider.</p></div>{finalizing && transcript.length > 0 ? <span className="acq-inline-status is-active">FINALIZING</span> : null}</header>{transcript.length === 0 ? (acceptanceUnknown ? <div className="acq-unknown-panel" role="status"><strong>No conversation is confirmed</strong><p>Exception Broker did not receive a call identity from CALL-E, so it cannot tell whether this request was accepted. It will not start a second call while that stays unknown.</p><small>{reconcileExhausted ? 'Exception Broker will not send another create request for this acquisition, and it will not start an independent call in its place.' : 'Reconciling re-sends the same acquisition under the same idempotency key, so CALL-E returns the original call if one exists.'}</small></div> : active ? <ProviderActivity phase={activityPhase} startedAt={startedAt} /> : <p className="acq-empty">Conversation evidence not available.</p>) : <div className="acq-transcript"><div className="acq-transcript-scroll"><ol className="transcript-timeline">{previewGroups.map((group) => renderTurnGroup(group, 'preview'))}</ol>{remainingTurns.length > 0 ? <div id="acq-transcript-remaining" className="acq-transcript-remaining" hidden={!transcriptExpanded}><ol className="transcript-timeline is-continued">{remainingGroups.map((group) => renderTurnGroup(group, 'remaining'))}</ol></div> : null}</div>{remainingTurns.length > 0 ? <button type="button" className="acq-transcript-toggle" aria-expanded={transcriptExpanded} aria-controls="acq-transcript-remaining" onClick={() => setTranscriptExpanded((value) => !value)}>{transcriptExpanded ? <>Collapse transcript <Arrow className="is-up" /></> : <>View remaining {remainingTurns.length} turns <Arrow className="is-down" /></>}</button> : null}</div>}</section><section className="acq-panel acq-evidence-formation"><div className="acq-evidence-block"><header><span className="acq-panel-icon" aria-hidden="true"><IconEvidence /></span><div><h2>Provider evidence</h2><p>{provider?.evidence.length ?? 0} real items returned for inspection.</p></div></header>{provider?.evidence.length ? <ol>{provider.evidence.slice(0, 3).map((item, index) => <li key={index}><b>{String(index + 1).padStart(2, '0')}</b><span>{item}</span></li>)}</ol> : <p className="acq-empty">{active ? <Activity label={finalizing ? 'CALL-E is finalizing the interaction…' : presentation.lifecycle === 'IN_PROGRESS' ? 'Waiting for provider evidence…' : 'Waiting for CALL-E to begin…'} /> : 'No provider evidence returned.'}</p>}{provider && provider.evidence.length > 3 ? <details className="acq-disclosure acq-all-evidence"><summary>View all evidence <Arrow /></summary><ul>{provider.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}</div><div className="acq-formation"><header><span className="acq-panel-icon" aria-hidden="true"><IconDecision /></span><div><h2>Decision formation</h2><p>Provider result to Exception Broker normalization.</p></div></header><ol><FormationStep number={1} title="Provider structured result" detail="Provider-returned response" state={provider?.structuredResult ? 'AVAILABLE' : active ? 'WAITING' : 'NOT AVAILABLE'} tone={provider?.structuredResult ? 'done' : 'waiting'} /><FormationStep number={2} title="Exception Broker normalization" detail="Result checked for usability" state={failed ? 'NOT REACHED' : record.normalizationStatus} tone={failed ? 'stopped' : record.normalizationStatus === 'USABLE' ? 'done' : record.normalizationStatus === 'SAFE_STOP' ? 'stopped' : 'waiting'} /><FormationStep number={3} title="Control eligibility" detail="Exact review stays separate" state={failed ? 'LOCKED' : record.handoffState === 'READY_FOR_REVIEW' ? 'READY FOR REVIEW' : record.handoffState.replaceAll('_', ' ')} tone={failed ? 'locked' : record.handoffState === 'READY_FOR_REVIEW' ? 'ready' : record.handoffState === 'SAFE_STOP' ? 'stopped' : 'locked'} /></ol><p>The provider supplies the structured result. Exception Broker does not infer a decision from transcript text.</p></div></section></div>
        {ready ? <section className="acq-resolution is-ready" aria-label="Control eligibility"><div className="acq-resolution-mark" aria-hidden="true"><IconDecision /></div><div><p className="acq-eyebrow">Decision acquired</p><h2>{record.normalizedResult?.decision}</h2><p>CALL-E · Live acquisition</p></div><div className="acq-resolution-copy"><strong>Acquired decision ≠ execution authority.</strong><span>Eligible for exact review. This decision is available for exact human review in Control. No review, application, or external execution has occurred.</span><small>✓ Provider completed &nbsp; ✓ Structured result processed &nbsp; ✓ Normalization usable</small><b>READY FOR REVIEW</b></div><div className="acq-resolution-action"><button type="button" disabled={handoffPending} onClick={() => void continueToControl()}>{handoffPending ? <Activity label="Preparing exact Control review…" /> : <>Continue to Control <Arrow /></>}</button><small>Handoff preserves the evidence chain</small></div></section> : null}
        {safeStop ? <section className={`acq-resolution is-safe-stop${clarificationRequired ? ' is-clarification' : ''}`} aria-label="Control eligibility"><div className="acq-resolution-mark" aria-hidden="true"><IconStop /></div><div><p className="acq-eyebrow">Acquisition outcome</p><h2>{clarificationRequired ? 'CLARIFICATION REQUIRED' : 'SAFE STOP'}</h2><p>{provider?.structuredResult ? `Provider decision: ${provider.structuredResult.decision}` : 'CALL-E · Terminal acquisition state'}</p></div><div className="acq-resolution-copy"><strong>{clarificationRequired ? 'The acquisition completed with a legitimate clarification outcome.' : incompleteAcquiredDecision ? 'CALL-E returned an acquired decision, but the provider did not mark the acquisition task complete.' : 'No usable decision established.'}</strong><span>{clarificationRequired ? 'The recipient requires additional information before a reviewable operational decision can exist.' : incompleteAcquiredDecision ? 'Required decision conditions were not sufficiently established to treat the result as usable.' : record.safeStopReason}</span><span>The acquisition stops without authority, review, or an application attempt.</span><small>✓ No authority &nbsp; ✓ No Control handoff &nbsp; ✓ No human review &nbsp; ✓ No application attempt &nbsp; ✓ No external effect</small><b>{clarificationRequired ? 'SAFE STOP · NOT READY FOR REVIEW' : 'NOT READY FOR REVIEW'}</b></div><div className="acq-resolution-action"><button type="button" disabled>Control unavailable</button><small>No handoff created · acquisition ended safely</small></div></section> : null}
        {acceptanceUnknown ? <section className="acq-resolution is-unresolved" aria-label="Acquisition reconciliation"><div className="acq-resolution-mark" aria-hidden="true"><IconStop /></div><div><p className="acq-eyebrow">Technical outcome</p><h2>{reconcileExhausted ? 'STILL UNRESOLVED' : 'NEEDS RECONCILIATION'}</h2><p>CALL-E · Acceptance unknown</p></div><div className="acq-resolution-copy"><strong>No decision was formed. No Control handoff or external execution occurred.</strong><span>{reconcileExhausted ? 'Exception Broker checked as often as it safely can. No further check will be made from here, and the acquisition stays held rather than reused.' : 'Exception Broker keeps this acquisition so a check can never turn into a second phone call.'}</span><TechnicalDetails detail={technical} /></div><div className="acq-resolution-action">{reconcileExhausted ? <><button type="button" disabled>No further checks</button><small>Acceptance stays unresolved · no new call from here</small></> : reconcileInput !== null ? <><button type="button" disabled={busy} onClick={reconcile}>{busy ? <Activity label="Checking with CALL-E…" /> : <>Retry safely <Arrow /></>}</button><small>Same acquisition · same idempotency key</small></> : byokReconcileNeeded ? <form className="acq-reconcile-form" onSubmit={reconcileByok}><label className="acq-phone-label" htmlFor="acquisition-reconcile-phone">Authorized recipient<input id="acquisition-reconcile-phone" name="reconcileRecipientPhone" aria-label="Authorized recipient" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(normalizePhoneInput(event.target.value))} placeholder="+15551234567" /></label><small>This must be the same recipient used for the original acquisition.</small><label className="authorization-check" htmlFor="acquisition-reconcile-authorization"><input id="acquisition-reconcile-authorization" name="reconcileAuthorizationConfirmed" type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span>I confirm I own or am authorized to call this recipient.</span></label><button type="submit" disabled={busy}>{busy ? <Activity label="Checking with CALL-E…" /> : <>Retry safely <Arrow /></>}</button><small>Same acquisition · same idempotency key · no new call is created</small></form> : <><button type="button" disabled>Reconcile unavailable here</button><small>Reopen this acquisition from the browser that started it</small></>}</div></section> : null}
        {failed ? <section className="acq-resolution is-failed" role="alert"><div className="acq-resolution-mark" aria-hidden="true">!</div><div><p className="acq-eyebrow">Technical outcome</p><h2>{presentation.lifecycle === 'CANCELED' ? 'CALL CANCELED' : 'CALL FAILED'}</h2><p>CALL-E · No business disposition</p></div><div className="acq-resolution-copy"><strong>No decision was formed. No Control handoff or external execution occurred.</strong><span>This is a technical provider outcome, not a business SAFE STOP, and it grants no review or authority.</span><TechnicalDetails detail={technical} /></div><div className="acq-resolution-action">{hostedRecoveryAvailable ? <><button type="button" disabled={busy} onClick={retryHostedTest}>{busy ? <Activity label="Starting recovery test…" /> : <>Retry hosted test <Arrow /></>}</button><small>Places one new live call to the synthetic destination</small></> : <><button type="button" disabled>Control locked</button><small>No decision exists to review</small></>}<p className="acq-failure-escape">{connectionKind === 'HOSTED_DEMO' ? <button type="button" onClick={() => void lock()}>Connect your CALL-E account</button> : null}<button type="button" onClick={onNavigateControl}>Try guided demo</button></p></div></section> : null}
        <details className="acq-provider-depth"><summary>Inspect sanitized provider evidence</summary><div><dl><dt>Acquisition ID</dt><dd>{record.acquisitionId}</dd><dt>Access mode</dt><dd>{record.accessMode ?? 'legacy record · mode unavailable'}</dd><dt>Request ID</dt><dd>{record.decisionContext.requestId}</dd><dt>Plan ID</dt><dd>{record.decisionContext.planId}</dd><dt>Masked recipient</dt><dd>{record.maskedRecipient}</dd><dt>Created</dt><dd>{record.createdAt}</dd><dt>Completed</dt><dd>{provider?.completedAt ?? 'not completed'}</dd><dt>Task completed</dt><dd>{provider?.taskCompleted === null || provider?.taskCompleted === undefined ? 'not available' : String(provider.taskCompleted)}</dd><dt>Summary</dt><dd>{provider?.summary ?? 'not available'}</dd><dt>Completion confidence</dt><dd>{provider?.completionConfidence ? `${provider.completionConfidence.score}${provider.completionConfidence.label ? ` · ${provider.completionConfidence.label}` : ''}` : 'not available'}</dd><dt>Normalization detail</dt><dd>{record.safeStopReason ?? 'not applicable'}</dd></dl><h3>All provider evidence</h3>{provider?.evidence.length ? <ul>{provider.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None returned.</p>}<h3>Structured result</h3><pre>{provider?.structuredResult ? JSON.stringify(provider.structuredResult, null, 2) : 'No schema-valid structured result returned.'}</pre><div className="acq-provenance"><p><strong>Acquisition provenance</strong> <span>{presentation.acquisitionProvenance}</span>. Real provider acquisition evidence returned by the server.</p><p><strong>Workflow context</strong> <span>Controlled sandbox template</span>. Not live ERP, WMS, customer, or order truth.</p></div></div></details>
        {!terminal && refreshCount >= maxRefreshes ? <section className="bounded-refresh" aria-label="Automatic monitoring complete"><div><p className="acq-eyebrow">{monitoringError ? 'Automatic status check paused' : 'CALL-E is still finalizing the interaction.'}</p><p>The acquisition record is preserved. You can check the latest provider status without starting another call.</p></div><button type="button" disabled={explicitRefreshPending} onClick={() => void refreshStatus()}>{explicitRefreshPending ? <Activity label="Checking latest provider status…" /> : 'Check latest status'}</button></section> : null}<div className="acquisition-reset"><button type="button" disabled={active} onClick={reset}>{active ? 'Available once this acquisition finishes' : 'Clear this acquisition'}</button></div></> : null}
      <p className="acquisition-announcement" aria-live="polite" aria-atomic="true">{busy && message ? <Activity label={message} /> : message}</p><footer className="acq-record-footer"><span>Exception Broker · v1.1.0</span><span>{record ? `Acquisition record ${record.acquisitionId}` : 'Controlled live acquisition'} · no external execution</span></footer>
      </> : null}
    </div></div>
  </main>{hostedModalOpen ? <HostedWarningModal busy={busy} onCancel={() => setHostedModalOpen(false)} onConfirm={confirmHostedDemo} /> : null}</div>;
};
