import { ProductTopbar } from './ProductShell.js';

/**
 * Control in its honest empty state.
 *
 * Control is the workspace for an ACQUIRED decision, so when no usable acquired decision
 * or restorable Live Control session exists there is nothing to work on — and the product
 * says exactly that rather than falling back to a deterministic proof case, inventing a
 * decision, or showing a dashboard of nothing.
 *
 * The prerequisite it states is the real one: a usable acquired decision. It is NOT an API
 * key — acquisition can run on the Hosted sandbox or on the user's own provider account —
 * so this surface never asks anyone to configure credentials.
 *
 * Nothing here is operational: no disposition, no APPROVED, no quantities, no case. The
 * three exits are deliberately unequal — acquire, then learn, then verify.
 */
const GateArrow = () => (
  <svg className="gate-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
);

/** The product's own decision mark, in its unfilled state: no decision is held. */
const EmptyDecisionMark = () => (
  <svg className="gate-mark" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 2.5 37.5 20 20 37.5 2.5 20Z" className="gate-mark-body" />
  </svg>
);

export const ControlGateExperience = ({ onNavigateHome, onNavigateAcquisition, onNavigateWalkthrough, onNavigateProof }: Readonly<{
  onNavigateHome: () => void;
  onNavigateAcquisition: () => void;
  onNavigateWalkthrough: () => void;
  onNavigateProof: () => void;
}>) => (
  <div className="app-shell proof-shell control-surface control-gate-shell"><div className="control-chassis">
    <ProductTopbar surface="control" onNavigateHome={onNavigateHome} onNavigateAcquisition={onNavigateAcquisition} onNavigateControl={() => undefined} />
    <main className="control-gate-page">
      <section className="control-gate" aria-labelledby="control-gate-title">
        <p className="eyebrow">Control</p>
        <div className="control-gate-head">
          <EmptyDecisionMark />
          <h1 id="control-gate-title">Control starts with an acquired decision.</h1>
        </div>
        <p className="control-gate-lede">Exception Broker first acquires a usable decision. Control then binds that decision to exact review and evaluates its application against operational reality.</p>
        <p className="control-gate-state">No acquired decision is held in this workspace.</p>
        <div className="control-gate-actions">
          <button type="button" className="gate-primary" onClick={onNavigateAcquisition}>Acquire a decision <GateArrow /></button>
          <button type="button" className="gate-secondary" onClick={onNavigateWalkthrough}>Guided walkthrough <GateArrow /></button>
        </div>
        <button type="button" className="gate-quiet" onClick={onNavigateProof}>Explore Control proof <GateArrow /></button>
      </section>
    </main>
  </div></div>
);
