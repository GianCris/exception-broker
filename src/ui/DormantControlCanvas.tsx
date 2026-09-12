import type { ReactNode } from 'react';

/**
 * Control when Control cannot run yet.
 *
 * The empty Gate and the recovery state are different truths, but they are the same
 * WORKSPACE, so they share one canvas instead of each getting its own page. What the canvas
 * draws is the real Control architecture — Decision, Application Boundary, Operational
 * Reality, Broker Disposition — reduced to its silhouette, with every region dormant. The
 * user should read "this is Control, and it has nothing to work on" rather than "this is an
 * empty card" or "this is an error page".
 *
 * The composition is deliberate: the four regions hold the corners, the boundary keeps the
 * spine, and the announcement sits in the middle of the architecture rather than on top of
 * it — so nothing structural is ever hidden behind the message. It is linework rather than
 * a grid of cards precisely so the architecture is sensed and not read as a dashboard of
 * four empty widgets.
 *
 * Nothing here is operational. There is no decision, no quantity, no case, no attempt and
 * no disposition — the regions state only that they are unavailable, which is the one true
 * thing about them.
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

/** One dormant region of the architecture: what it is, and that it is not available. */
const DormantRegion = ({ place, label, state }: Readonly<{ place: string; label: string; state: string }>) => (
  <div className={`dormant-region dormant-${place}`}>
    <p className="control-label">{label}</p>
    <strong>{state}</strong>
  </div>
);

/**
 * The architecture itself, in its dormant state. It is exposed to assistive technology
 * rather than hidden, because "Operational reality — not evaluated" is a true statement
 * about this workspace and not decoration.
 */
const DormantArchitecture = () => (
  <div className="dormant-architecture" role="group" aria-label="Control architecture, dormant">
    <DormantRegion place="decision" label="Decision" state="Awaiting acquired decision" />
    <div className="dormant-boundary">
      <i className="dormant-rail" aria-hidden="true" />
      <div className="dormant-plate">
        <span className="control-label">Application boundary</span>
        <strong>NOT AVAILABLE</strong>
      </div>
    </div>
    <DormantRegion place="reality" label="Operational reality" state="Not evaluated" />
    <DormantRegion place="review" label="Exact review" state="Not available yet" />
    <DormantRegion place="disposition" label="Broker disposition" state="No disposition" />
  </div>
);

/**
 * The focal announcement sits in the middle of the dormant architecture: one message, then
 * one deliberately unequal set of exits. Callers supply the actions because the Gate and
 * recovery lead to different places for different reasons.
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
