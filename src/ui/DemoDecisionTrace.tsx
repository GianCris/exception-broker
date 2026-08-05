import { useId, useState } from 'react';

import type { DemoStep } from '../demo/demoTypes.js';

export const DemoDecisionTrace = ({ steps }: Readonly<{ steps: readonly DemoStep[] }>) => {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <section className="section trace-section" aria-labelledby="demo-trace-title">
      <button className="trace-toggle" type="button" aria-expanded={open} aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}>
        <span><span className="trace-icon" aria-hidden="true">≡</span><strong id="demo-trace-title">View decision trace</strong><small>Audit identifiers from the local simulation</small></span>
        <span className="toggle-symbol" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="trace-content" id={contentId}>
        <ol className="demo-trace-list">
          {steps.map((step) => <li key={step.type}>
            <strong>{step.type}</strong><p>{step.message}</p>
            <div className="demo-id-list">
              {step.planId ? <span>Plan {step.planId}</span> : null}
              {step.actorId ? <span>Actor {step.actorId}</span> : null}
              {step.requestId ? <span>Request {step.requestId}</span> : null}
              {step.operationId ? <span>Operation {step.operationId}</span> : null}
              {step.approvalId ? <span>Approval {step.approvalId}</span> : null}
            </div>
          </li>)}
        </ol>
      </div> : null}
    </section>
  );
};
