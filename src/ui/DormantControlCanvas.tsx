import type { ReactNode } from 'react';

/**
 * Control when Control cannot run yet.
 *
 * The empty Gate and the recovery state are different truths, but they are the same
 * WORKSPACE, so they share one canvas instead of each getting its own page. What the canvas
 * draws is the real Control instrument — Decision and Exact Review on the left, the
 * Application Boundary on the spine, Operational Reality and Broker Disposition on the
 * right — in its own geometry and spacing, as a ghost. The user should read "the whole
 * Control system is here, and there is nothing to activate it with", never "this is an
 * empty card" or "this is an error page".
 *
 * The ghost is ATMOSPHERE AND STRUCTURE, never fictional operational state. Every ghost row
 * is an abstract bar with no glyphs in it: there is no decision, no quantity, no case, no
 * attempt and no disposition anywhere on this surface, because inventing one to make an
 * empty state look busy is exactly the lie this product exists to refuse. The only words
 * are the region names and the one true thing about each — that it is unavailable.
 *
 * This canvas belongs to the EMPTY and RECOVERY states only. An acquired decision, live or
 * deterministic, renders the real instrument and never this.
 */

const CanvasArrow = () => (
  <svg className="gate-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
);

/** The product's own decision mark, unfilled: Control holds no decision object. */
const DormantDecisionMark = () => (
  <svg className="gate-mark" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 2.5 37.5 20 20 37.5 2.5 20Z" className="gate-mark-body" />
  </svg>
);

/**
 * Ghost primitives. Bars, not text — so the structure of each Control object is legible
 * while its content is, by construction, unreadable and unfakeable.
 */
const GhostBar = ({ span }: Readonly<{ span: number }>) => <i className="ghost-bar" style={{ width: `${span}%` }} />;
const GhostRow = ({ label, value }: Readonly<{ label: number; value: number }>) => (
  <i className="ghost-row"><i className="ghost-bar" style={{ width: `${label}%` }} /><i className="ghost-bar ghost-value" style={{ width: `${value}px` }} /></i>
);

/** Decision: a mark, the headline the decision would occupy, and its provenance line. */
const GhostDecision = () => (
  <i className="ghost-body ghost-decision">
    <i className="ghost-mark" />
    <i className="ghost-headline" />
    <GhostBar span={72} />
    <i className="ghost-rule" />
    <GhostBar span={46} />
  </i>
);

/** Exact review: the proposal table, as line structure only. */
const GhostReview = () => (
  <i className="ghost-body ghost-review">
    {[74, 66, 80, 58, 70].map((label, index) => <GhostRow key={index} label={label} value={26 + (index % 3) * 9} />)}
    <i className="ghost-rule" />
    <i className="ghost-action" />
  </i>
);

/** Operational reality: the two measured slots the boundary compares, unfilled. */
const GhostReality = () => (
  <i className="ghost-body ghost-reality">
    <GhostBar span={62} />
    <i className="ghost-measure"><i className="ghost-slot" /><i className="ghost-link" /><i className="ghost-slot" /></i>
    <i className="ghost-rule" />
    <GhostBar span={54} />
  </i>
);

/** Broker disposition: the answer block, with nothing in it to answer. */
const GhostDisposition = () => (
  <i className="ghost-body ghost-disposition">
    <i className="ghost-headline ghost-headline--short" />
    <GhostBar span={80} />
    <GhostBar span={58} />
    <i className="ghost-rule" />
    <GhostBar span={44} />
  </i>
);

/**
 * One dormant region: the real panel's silhouette, its name, and the one true thing about
 * it. The ghost interior is hidden from assistive technology because it carries no
 * information — the label and the state below it carry all of it.
 */
const DormantRegion = ({ place, label, state, ghost }: Readonly<{ place: string; label: string; state: string; ghost: ReactNode }>) => (
  <div className={`dormant-region dormant-${place}`}>
    <p className="control-label">{label}</p>
    <strong>{state}</strong>
    <span className="ghost-panel" aria-hidden="true">{ghost}</span>
  </div>
);

/**
 * The instrument in its dormant state. It is exposed to assistive technology rather than
 * hidden, because "Operational reality — not evaluated" is a true statement about this
 * workspace and not decoration.
 */
const DormantArchitecture = () => (
  <div className="dormant-architecture" role="group" aria-label="Control architecture, dormant">
    <DormantRegion place="decision" label="Decision" state="Awaiting acquired decision" ghost={<GhostDecision />} />
    <DormantRegion place="review" label="Exact review" state="Not available yet" ghost={<GhostReview />} />
    <div className="dormant-boundary">
      <i className="dormant-rail" aria-hidden="true" />
      <div className="dormant-plate">
        <span className="control-label">Application boundary</span>
        <strong>NOT AVAILABLE</strong>
      </div>
    </div>
    <DormantRegion place="reality" label="Operational reality" state="Not evaluated" ghost={<GhostReality />} />
    <DormantRegion place="disposition" label="Broker disposition" state="No disposition" ghost={<GhostDisposition />} />
  </div>
);

/**
 * The focal announcement sits within the dormant instrument: one message, then one
 * deliberately unequal set of exits. It is sharp, lit and unmistakably above the ghost —
 * which recedes behind it rather than competing with it. Callers supply the actions because
 * the Gate and recovery lead to different places for different reasons.
 */
export const DormantControlCanvas = ({ titleId, eyebrow, title, lede, state, actions }: Readonly<{
  titleId: string;
  eyebrow: string;
  title: string;
  lede: string;
  state?: string;
  actions?: ReactNode;
}>) => (
  <main className="control-dormant-page">
    <div className="control-dormant-canvas">
      <DormantArchitecture />
      <section className="dormant-announcement" aria-labelledby={titleId}>
        <p className="eyebrow">{eyebrow}</p>
        <div className="dormant-announcement-head">
          <DormantDecisionMark />
          <h1 id={titleId}>{title}</h1>
        </div>
        <p className="dormant-lede">{lede}</p>
        {state === undefined ? null : <p className="dormant-state">{state}</p>}
        {actions}
      </section>
    </div>
  </main>
);

/** The shared arrow, so callers build their exits in the canvas's own language. */
export const DormantArrow = CanvasArrow;
