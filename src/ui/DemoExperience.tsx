import { useRef, useState } from 'react';

import type {
  DemoCaseNarrative,
  DemoRunResult,
  DemoRunnerInput,
  PartialDemoCaseNarrative,
} from '../demo/demoTypes.js';
import { DemoDecisionTrace } from './DemoDecisionTrace.js';
import { BrokerMark } from './CaseHeader.js';

type DemoRunner = (input: DemoRunnerInput) => Promise<DemoRunResult>;

const Narrative = ({ narrative }: Readonly<{ narrative: PartialDemoCaseNarrative }>) => (
  <div className="demo-narrative">
    {narrative.plan001 ? <article className="demo-evidence evidence-rejected">
      <p className="eyebrow">Initial proposal</p><h3>{narrative.plan001.planId} · Rejected</h3>
      <p>{narrative.plan001.summary}</p>
      <div className="demo-code-list">{narrative.plan001.reasonCodes.map((code) => <strong key={code}>{code}</strong>)}</div>
    </article> : null}
    {narrative.plan002 ? <article className="demo-evidence evidence-warning">
      <p className="eyebrow">Constraint deadlock</p><h3>{narrative.plan002.planId} · No solution</h3>
      <div className="quantity-comparison"><span><strong>{narrative.plan002.availableQuantity}</strong> available</span><span><strong>{narrative.plan002.requiredQuantity}</strong> required</span></div>
    </article> : null}
    {narrative.authorization ? <article className="demo-evidence evidence-authorization">
      <p className="eyebrow">Authorization reviewed</p><h3>{narrative.authorization.field}</h3>
      <p className="authorization-values" aria-label={`${narrative.authorization.previousValue} changed to ${narrative.authorization.newValue}`}><span>{narrative.authorization.previousValue}</span> → <strong>{narrative.authorization.newValue}</strong></p>
      {narrative.authorization.summary ? <p>{narrative.authorization.summary}</p> : null}
    </article> : null}
    {narrative.plan003 ? <article className="demo-evidence evidence-approved">
      <p className="eyebrow">Final recovery plan</p><h3>{narrative.plan003.planId} · Approved</h3>
      <div className="demo-approvers">{narrative.plan003.approvers.map((approver) => <span key={approver.approvalId}>✓ {approver.actorRole}</span>)}</div>
    </article> : null}
  </div>
);

const Completed = ({ result }: Readonly<{ result: Extract<DemoRunResult, { status: 'COMPLETED' }> }>) => (
  <div className="demo-result" role="status" aria-live="polite">
    <section className="demo-resolution">
      <p className="eyebrow">Resolution completed</p><h2>Case resolved safely</h2>
      <p>{result.caseNarrative.plan003.planId} reached approval after all three parties agreed.</p>
    </section>
    <Narrative narrative={result.caseNarrative} />
    <section className="section" aria-labelledby="steps-title"><div className="section-heading compact"><div><p className="eyebrow">Verified execution</p><h2 id="steps-title">Resolution steps</h2></div></div>
      <ol className="demo-steps">{result.steps.map((step) => <li key={step.type}><span aria-hidden="true">✓</span><div><strong>{step.type.replaceAll('_', ' ')}</strong><p>{step.message}</p></div></li>)}</ol>
    </section>
    <DemoDecisionTrace steps={result.steps} />
  </div>
);

const Failed = ({ result }: Readonly<{ result: Extract<DemoRunResult, { status: 'FAILED' }> }>) => (
  <div className="demo-result" role="alert">
    <section className="demo-resolution demo-failed"><p className="eyebrow">Case not resolved</p><h2>Simulation stopped safely</h2><p><strong>{result.failedStep}</strong>: {result.reason}</p></section>
    <Narrative narrative={result.caseNarrative} />
    <p className="safe-state">Last safe state: {result.partialState.plans.length} plan versions and {result.partialState.approvals.length} recorded decisions.</p>
    {result.steps.length > 0 ? <DemoDecisionTrace steps={result.steps} /> : null}
  </div>
);

const Blocked = ({ result }: Readonly<{ result: Extract<DemoRunResult, { status: 'BLOCKED' }> }>) => (
  <section className="demo-resolution demo-blocked" role="alert"><p className="eyebrow">Flow not executed</p><h2>Demo blocked safely</h2><p>Mode: {result.mode}</p><p>{result.reason}</p><p>No calls were made and no balance was used.</p></section>
);

export const DemoExperience = ({ runner, createInput }: Readonly<{
  runner: DemoRunner;
  createInput: () => DemoRunnerInput;
}>) => {
  const [state, setState] = useState<'IDLE' | 'RUNNING'>('IDLE');
  const [result, setResult] = useState<DemoRunResult | null>(null);
  const running = useRef(false);
  const execute = async () => {
    if (running.current) return;
    running.current = true; setState('RUNNING'); setResult(null);
    try { setResult(await runner(createInput())); } finally { running.current = false; setState('IDLE'); }
  };
  return <div className="app-shell"><main>
    <header className="case-header demo-header">
      <div className="brand-row"><BrokerMark /><span className="brand-name">Exception Broker</span></div>
      <div className="header-content"><div><p className="case-label">Safe exception resolution</p><h1>Resolve a supply exception across three parties</h1><p className="commercial-copy">Constraint-aware decisions turn a blocked delivery into one auditable recovery plan.</p></div></div>
      <div className="demo-mode-bar"><span><small>Demo mode</small><strong>Local simulation</strong></span><span className="no-calls">● No real calls</span>
        <button type="button" className="run-demo-button" onClick={execute} disabled={state === 'RUNNING' || result?.status === 'COMPLETED'}>{state === 'RUNNING' ? 'Running local simulation…' : result?.status === 'COMPLETED' ? 'Demo completed' : result?.status === 'FAILED' ? 'Run exception resolution again' : 'Run exception resolution'}</button></div>
    </header>
    <div className="demo-state" aria-live="polite">{state === 'RUNNING' ? <p>Running the deterministic local simulation. No calls are being made.</p> : result === null ? <p>Ready. Run the local demo to produce a verified resolution.</p> : null}</div>
    {result?.status === 'COMPLETED' ? <Completed result={result} /> : null}
    {result?.status === 'FAILED' ? <Failed result={result} /> : null}
    {result?.status === 'BLOCKED' ? <Blocked result={result} /> : null}
  </main><footer>Exception Broker · Deterministic local demonstration</footer></div>;
};
