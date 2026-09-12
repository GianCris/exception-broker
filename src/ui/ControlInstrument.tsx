import { forwardRef, type ReactNode } from 'react';
import { motion, MotionConfig } from 'motion/react';

import type {
  ControlAttempt, ControlBoundary, ControlDecision, ControlDisposition, ControlProposal,
  ControlQueueItem, ControlReality, ControlReview, ControlSurfaceModel, ControlTakeaway,
} from '../presentation/controlSurfaceViewModel.js';
import { motionTokens } from './motion.js';
import { SentinelScene } from './ProductShell.js';

// Quiet → one consequential activation → quiet. Each stage is revealed only after the
// stage that caused it, so the choreography teaches causality rather than decorating it.
const stage = (index: number) => ({ ...motionTokens.reveal, delay: index * 0.12 });

// The acquired Decision is an object, not a step. It keeps the same mark in every state.
const DecisionDiamond = () => (
  <svg className="control-diamond" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 2.5 37.5 20 20 37.5 2.5 20Z" className="control-diamond-body" />
    <path d="M16.2 13.6h5.6l3.1 3.1v9.7h-8.7Z" className="control-diamond-mark" />
    <path d="M18.3 21.2h4.2M18.3 24h3" className="control-diamond-rule" />
  </svg>
);

const DecisionFixed = ({ decision }: Readonly<{ decision: ControlDecision }>) => (
  <motion.section className={`control-object control-decision ${decision.available ? '' : 'decision-unavailable'}`}
    aria-label="Decision fixed" initial={false} animate={{ opacity: 1 }} transition={motionTokens.settle}>
    <p className="control-label">{decision.state}</p>
    <div className="control-decision-head"><DecisionDiamond /><h2>{decision.label}</h2></div>
    <p className="control-decision-note">{decision.note}</p>
    {decision.available ? <p className="control-decision-source"><strong>{decision.sourceLabel}</strong><small>{decision.sourceDetail}</small></p> : null}
  </motion.section>
);

const ExactReviewSummary = ({ review, proposal, action }: Readonly<{
  review: ControlReview; proposal?: ControlProposal | undefined; action?: ReactNode;
}>) => (
  <motion.section className={`control-object control-review review-${review.state.toLowerCase()}`} aria-label="Exact review"
    initial={false} animate={{ opacity: 1 }} transition={stage(1)}>
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
const ApplicationBoundary = ({ boundary, attempt }: Readonly<{ boundary: ControlBoundary; attempt?: ControlAttempt | undefined }>) => (
  <div className={`control-boundary boundary-${boundary.state.toLowerCase().replaceAll(' ', '-')}`} aria-label="Application boundary">
    <motion.i className="boundary-rail" aria-hidden="true" initial={false}
      animate={{ opacity: boundary.engaged ? 1 : 0.5, scaleY: 1 }} transition={motionTokens.causal} />
    <div className="boundary-plate">
      <span className="control-label">Application boundary</span>
      <strong>{boundary.state}</strong>
      {attempt ? <motion.span className="boundary-attempt" key={attempt.key}
        initial={{ opacity: 0.5, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={stage(1)}>
        Attempt #{attempt.ordinal}
      </motion.span> : null}
      <small>{boundary.note}</small>
    </div>
  </div>
);

const ApplicationAttempt = ({ attempt }: Readonly<{ attempt: ControlAttempt }>) => (
  <motion.section className={`control-attempt attempt-${attempt.treatment}`} aria-label="Application Attempt"
    key={attempt.key} initial={{ opacity: 0.55, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={stage(0)}>
    <span className="control-label">Application attempt #{attempt.ordinal}</span>
    <strong>{attempt.label}</strong><small>{attempt.detail}</small>
  </motion.section>
);

const OperationalReality = ({ reality }: Readonly<{ reality: ControlReality }>) => (
  <motion.section className={`control-object control-reality reality-${reality.kind.toLowerCase().replaceAll('_', '-')}`}
    aria-label="Operational reality" initial={false} animate={{ opacity: 1 }} transition={stage(2)}>
    <p className="control-label">Operational reality</p>
    <h3>{reality.headline}</h3>
    {reality.kind === 'MEASURED' ? <>
      <div className="reality-measure">
        <article className="measure-required"><span>Required</span><strong>{reality.required}</strong><small>{reality.unit}</small></article>
        <b aria-hidden="true">→</b>
        <article className="measure-available"><span>Available</span><strong>{reality.available}</strong><small>{reality.unit}</small></article>
      </div>
      <p className="reality-authorization"><span>Client authorization</span><strong>{reality.authorization}</strong></p>
      <p className={`reality-causal ${reality.causalSupported ? 'causal-supported' : 'causal-unsupported'}`}>{reality.causal}</p>
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

const BrokerDisposition = ({ disposition }: Readonly<{ disposition: ControlDisposition }>) => (
  <motion.section className={`control-object control-disposition ${disposition.resolved ? 'disposition-resolved' : 'disposition-quiet'}`}
    aria-label="Broker disposition" initial={false} animate={{ opacity: 1 }} transition={stage(3)}>
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
  ariaLabel: string; model: ControlSurfaceModel; reviewAction?: ReactNode;
}>>(({ ariaLabel, model, reviewAction }, ref) => (
  <MotionConfig reducedMotion="user">
    <section ref={ref} className={`control-instrument instrument-${model.disposition.tone}`} aria-label={ariaLabel} tabIndex={-1}>
      <div className="control-column control-column-decision">
        <DecisionFixed decision={model.decision} />
        <ExactReviewSummary review={model.review} proposal={model.proposal} action={reviewAction} />
        {model.attempt ? <ApplicationAttempt attempt={model.attempt} /> : null}
      </div>
      <ApplicationBoundary boundary={model.boundary} attempt={model.attempt} />
      <div className="control-column control-column-reality">
        <OperationalReality reality={model.reality} />
        <BrokerDisposition disposition={model.disposition} />
      </div>
    </section>
  </MotionConfig>
));

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
