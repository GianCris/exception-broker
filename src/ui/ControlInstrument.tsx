import { forwardRef, type ReactNode } from 'react';
import { motion, MotionConfig, useReducedMotion, type Transition } from 'motion/react';

import type {
  ControlAttempt, ControlBoundary, ControlDecision, ControlDisposition, ControlProposal,
  ControlQueueItem, ControlReality, ControlReview, ControlSurfaceModel, ControlTakeaway,
} from '../presentation/controlSurfaceViewModel.js';
import { applyStages, motionTokens } from './motion.js';
import { SentinelScene } from './ProductShell.js';

// Quiet → one consequential activation → quiet. Each stage is revealed only after the
// stage that caused it, so the choreography teaches causality rather than decorating it.
// Nothing animates layout: every stage is opacity or a transform that cannot move the
// camera, grow the instrument, or extend its scroll box.
const controlEase: [number, number, number, number] = [...motionTokens.reveal.ease];
type Stage = (delayMs: number, duration?: number) => Transition;
const useStage = (): Stage => {
  const reduced = useReducedMotion();
  // With reduced motion the transition is over before it starts: the resolved state is
  // readable immediately and nothing waits on decoration.
  return (delayMs, duration = 0.2) => reduced
    ? { duration: 0 }
    : { duration, ease: controlEase, delay: delayMs / 1000 };
};

// The acquired Decision is an object, not a step. It keeps the same mark in every state.
const DecisionDiamond = () => (
  <svg className="control-diamond" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 2.5 37.5 20 20 37.5 2.5 20Z" className="control-diamond-body" />
    <path d="M16.2 13.6h5.6l3.1 3.1v9.7h-8.7Z" className="control-diamond-mark" />
    <path d="M18.3 21.2h4.2M18.3 24h3" className="control-diamond-rule" />
  </svg>
);

// The acquired decision never travels and never changes semantic colour, so it is the one
// object with no entry animation at all — it is the fixed point the choreography moves around.
const DecisionFixed = ({ decision }: Readonly<{ decision: ControlDecision }>) => (
  <motion.section className={`control-object control-decision ${decision.available ? '' : 'decision-unavailable'}`}
    aria-label="Decision fixed" initial={false} animate={{ opacity: 1 }} transition={motionTokens.settle}>
    <p className="control-label">{decision.state}</p>
    <div className="control-decision-head"><DecisionDiamond /><h2>{decision.label}</h2></div>
    <p className="control-decision-note">{decision.note}</p>
    {decision.available ? <p className="control-decision-source"><strong>{decision.sourceLabel}</strong><small>{decision.sourceDetail}</small></p> : null}
  </motion.section>
);

const ExactReviewSummary = ({ review, proposal, action, stage }: Readonly<{
  review: ControlReview; proposal?: ControlProposal | undefined; action?: ReactNode; stage: Stage;
}>) => (
  // Stage 1: the review is confirmed and settles into its demoted material.
  <motion.section key={review.state} className={`control-object control-review review-${review.state.toLowerCase()}`} aria-label="Exact review"
    initial={{ opacity: 0.5 }} animate={{ opacity: 1 }} transition={stage(applyStages.review, 0.22)}>
    <p className="control-label">{review.label}</p>
    {proposal ? <>
      <dl className="control-proposal">
        {proposal.lines.map((line) => <div key={line.label} {...(line.total ? { className: 'proposal-total' } : {})}>
          <dt>{line.label}</dt><dd>{line.value}</dd>
        </div>)}
      </dl>
      <p className="control-proposal-note">{proposal.note}</p>
    </> : null}
    {action}
    {action ? null : <p className="control-review-detail">{review.detail}</p>}
  </motion.section>
);

// The signature element. It separates decision and review from reality and disposition,
// and it carries exactly one state: not engaged, evaluated, or not available.
const ApplicationBoundary = ({ boundary, attempt, stage }: Readonly<{ boundary: ControlBoundary; attempt?: ControlAttempt | undefined; stage: Stage }>) => (
  <div className={`control-boundary boundary-${boundary.state.toLowerCase().replaceAll(' ', '-')}`} aria-label="Application boundary">
    {/* Stage 3: the boundary engages exactly once — the rail draws to full and lights. */}
    <motion.i className="boundary-rail" aria-hidden="true" key={`${boundary.state}-${attempt?.key ?? 'none'}`}
      initial={{ opacity: boundary.engaged ? 0.4 : 0.5, scaleY: boundary.engaged ? 0.82 : 1 }}
      animate={{ opacity: boundary.engaged ? 1 : 0.5, scaleY: 1 }}
      transition={stage(applyStages.boundary, 0.24)} />
    <div className="boundary-plate">
      <span className="control-label">Application boundary</span>
      <strong>{boundary.state}</strong>
      {attempt ? <motion.span className="boundary-attempt" key={attempt.key}
        initial={{ opacity: 0.5, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={stage(applyStages.boundary)}>
        Attempt #{attempt.ordinal}
      </motion.span> : null}
      <small>{boundary.note}</small>
    </div>
  </div>
);

// Stage 2: the object that is actually evaluated arrives, from the review that caused it.
const ApplicationAttempt = ({ attempt, stage }: Readonly<{ attempt: ControlAttempt; stage: Stage }>) => (
  <motion.section className={`control-attempt attempt-${attempt.treatment}`} aria-label="Application Attempt"
    key={attempt.key} initial={{ opacity: 0.55, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={stage(applyStages.attempt)}>
    <span className="control-label">Application attempt #{attempt.ordinal}</span>
    <strong>{attempt.label}</strong><small>{attempt.detail}</small>
  </motion.section>
);

const OperationalReality = ({ reality, attemptKey, stage }: Readonly<{ reality: ControlReality; attemptKey: string; stage: Stage }>) => (
  // Stage 4: reality stops being dormant and is measured against the attempt.
  <motion.section key={`${reality.kind}-${attemptKey}`} className={`control-object control-reality reality-${reality.kind.toLowerCase().replaceAll('_', '-')}`}
    aria-label="Operational reality" initial={{ opacity: 0.35 }} animate={{ opacity: 1 }} transition={stage(applyStages.reality, 0.22)}>
    <p className="control-label">Operational reality</p>
    <h3>{reality.headline}</h3>
    {reality.kind === 'MEASURED' ? <>
      <div className="reality-measure">
        <article className="measure-required"><span>Required</span><strong>{reality.required}</strong><small>{reality.unit}</small></article>
        {/* Stage 5: the required/available relationship resolves. */}
        <motion.b aria-hidden="true" initial={{ opacity: 0, scaleX: 0.35 }} animate={{ opacity: 1, scaleX: 1 }} transition={stage(applyStages.resolve, 0.18)}>→</motion.b>
        <article className="measure-available"><span>Available</span><strong>{reality.available}</strong><small>{reality.unit}</small></article>
      </div>
      <p className="reality-authorization"><span>Client authorization</span><strong>{reality.authorization}</strong></p>
      <motion.p className={`reality-causal ${reality.causalSupported ? 'causal-supported' : 'causal-unsupported'}`}
        initial={{ opacity: 0.25 }} animate={{ opacity: 1 }} transition={stage(applyStages.resolve + 60, 0.18)}>{reality.causal}</motion.p>
    </> : null}
    {reality.kind === 'CONFLICTED' ? <>
      <div className="reality-claims">
        {reality.claims.map((claim, index) => <article key={claim.key}>
          {index > 0 ? <b className="claims-conflict" aria-hidden="true">≠</b> : null}
          <span>{claim.sourceLabel}</span><strong>{claim.value}</strong><small>{claim.unit}</small><em>{claim.sourceDetail}</em>
        </article>)}
      </div>
      <p className="reality-causal causal-unsupported">{reality.note}</p>
    </> : null}
    {reality.kind === 'CONTEXT' ? <div className="reality-context">
      {reality.facts.map((fact) => <article key={fact.key}><span>{fact.label}</span><strong>{fact.value}</strong><small>{fact.note}</small></article>)}
      <p className="reality-causal causal-neutral">{reality.note}</p>
    </div> : null}
    {reality.kind === 'NOT_EVALUATED' ? <>
      {/* A dormant instrument, not an empty panel: the two slots reality will occupy are
          drawn unfilled and boundary-facing. Decorative only — it states no quantity. */}
      <div className="reality-dormant" aria-hidden="true">
        <span className="dormant-slot"><i /></span>
        <span className="dormant-link" />
        <span className="dormant-slot"><i /></span>
      </div>
      <p className="reality-pending">{reality.note}</p>
    </> : null}
  </motion.section>
);

const BrokerDisposition = ({ disposition, attemptKey, stage }: Readonly<{ disposition: ControlDisposition; attemptKey: string; stage: Stage }>) => (
  // Stage 6: the Broker answers, and then everything is quiet again.
  <motion.section key={`${disposition.label}-${attemptKey}`} className={`control-object control-disposition ${disposition.resolved ? 'disposition-resolved' : 'disposition-quiet'}`}
    aria-label="Broker disposition" data-walkthrough-target="disposition" initial={{ opacity: 0.2, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={stage(applyStages.disposition, 0.22)}>
    <p className="control-label">Broker disposition</p>
    <strong className="disposition-label">{disposition.label}</strong>
    <p className="disposition-headline">{disposition.headline}</p>
    <p className="disposition-code">{disposition.code}</p>
    {disposition.effects ? <p className="disposition-effects">{disposition.effects}</p> : null}
    <p className="disposition-supporting">{disposition.supporting}</p>
  </motion.section>
);

export const ControlKeyTakeaway = ({ takeaway, tone }: Readonly<{ takeaway: ControlTakeaway; tone: string }>) => (
  <aside className={`control-takeaway takeaway-${tone}`} aria-label="Key takeaway">
    <span>Key takeaway</span><strong>{takeaway.verdict}</strong><p>{takeaway.detail}</p>
  </aside>
);

export const ControlInstrument = forwardRef<HTMLElement, Readonly<{
  ariaLabel: string; model: ControlSurfaceModel; reviewAction?: ReactNode; sceneKey?: string;
}>>(({ ariaLabel, model, reviewAction, sceneKey }, ref) => {
  const stage = useStage();
  const attemptKey = model.attempt?.key ?? 'no-attempt';
  return <MotionConfig reducedMotion="user">
    {/* Switching cases is a camera-stable change of subject, not a page transition. */}
    <motion.section ref={ref} key={sceneKey} className={`control-instrument instrument-${model.disposition.tone}`}
      aria-label={ariaLabel} tabIndex={-1} initial={{ opacity: 0.4, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={stage(0, 0.18)}>
      <div className="control-column control-column-decision">
        <DecisionFixed decision={model.decision} />
        <ExactReviewSummary review={model.review} proposal={model.proposal} action={reviewAction} stage={stage} />
        {model.attempt ? <ApplicationAttempt attempt={model.attempt} stage={stage} /> : null}
      </div>
      <ApplicationBoundary boundary={model.boundary} attempt={model.attempt} stage={stage} />
      <div className="control-column control-column-reality">
        <OperationalReality reality={model.reality} attemptKey={attemptKey} stage={stage} />
        <BrokerDisposition disposition={model.disposition} attemptKey={attemptKey} stage={stage} />
      </div>
    </motion.section>
  </MotionConfig>;
});

export const AttentionQueue = ({ items, selectedId, onSelect, title, description, children }: Readonly<{
  items: readonly ControlQueueItem[]; selectedId: string; onSelect: (id: string) => void;
  title: string; description: string; children?: ReactNode;
}>) => (
  <aside className="control-queue" aria-labelledby="queue-title">
    <div className="queue-top">
    <p className="eyebrow">Decision control queue</p>
    <h1 id="queue-title">{title}</h1>
    <p>{description}</p>
    <div className="queue-list">{items.map((item) => (
      <button type="button" key={item.id} aria-pressed={item.id === selectedId}
        aria-label={`${item.id} / ${item.name} · ${item.state} · ${item.attention}`} onClick={() => onSelect(item.id)}>
        <span className="queue-heading"><strong>{item.name}</strong><small>{item.caseRef}</small></span>
        <span className={`queue-state disposition disposition-${item.state.toLowerCase().replaceAll(' ', '-')}`}>{item.state}</span>
        <span className="queue-attention">{item.attention}</span>
        {item.fact ? <span className="queue-fact">{item.fact}</span> : null}
      </button>
    ))}</div>
    {children}
    </div>
    <SentinelScene />
  </aside>
);
