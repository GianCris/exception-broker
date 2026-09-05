import { forwardRef, type ReactNode } from 'react';
import { motion, MotionConfig } from 'motion/react';

import { motionTokens } from './motion.js';

type InstrumentAttempt = Readonly<{
  key: string;
  review: string;
  proposal: string;
}>;

export const CentralInstrument = forwardRef<HTMLElement, Readonly<{
  ariaLabel: string;
  decision: string;
  decisionContext: string;
  authority: string;
  authorityContext: string;
  operationalTruth: ReactNode;
  operationalTruthSummary: string;
  disposition: string;
  why: string;
  effects?: string;
  attempt?: InstrumentAttempt;
}>>(({
  ariaLabel,
  decision,
  decisionContext,
  authority,
  authorityContext,
  operationalTruth,
  operationalTruthSummary,
  disposition,
  why,
  effects,
  attempt,
}, ref) => {
  const tone = disposition.toLowerCase().replaceAll(' ', '-');
  const attemptTreatment = disposition === 'ALLOW' ? 'complete'
    : disposition === 'BLOCK' ? 'interrupted'
    : disposition === 'WAIT' ? 'suspended'
    : disposition === 'REJECTED' || disposition === 'PLAN_REJECTED' ? 'neutral'
    : 'neutral-stopped';
  const boundaryState = disposition === 'ALLOW' ? 'CONTROL PASSED'
    : disposition === 'BLOCK' ? 'ATTEMPT STOPPED'
    : disposition === 'WAIT' && attempt ? 'ATTEMPT HELD'
    : disposition === 'REJECTED' || disposition === 'PLAN_REJECTED' ? 'DECISION RECORDED'
    : attempt ? 'ATTEMPT STOPPED'
    : 'NOT ENGAGED';
  return <MotionConfig reducedMotion="user">
    <section ref={ref} className={`central-instrument instrument-${tone}`} aria-label={ariaLabel} tabIndex={-1}>
      <motion.header className="instrument-decision" layout transition={motionTokens.settle}>
        <p className="instrument-label">Decision</p>
        <h2>{decision}</h2>
        <p>{decisionContext}</p>
        <div className="instrument-authority"><span>Human review</span><strong>{authority}</strong><small>{authorityContext}</small></div>
      </motion.header>

      <div className={`instrument-causal ${attempt ? 'causal-engaged' : 'causal-idle'}`}>
        {attempt ? <motion.section
            key={attempt.key}
            className={`instrument-attempt attempt-${attemptTreatment}`}
            aria-label="Application Attempt"
            initial={{ opacity: 0.6, x: -8, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTokens.reveal}
          >
            <span>Application Attempt</span><strong>{attempt.review}</strong><small>{attempt.proposal}</small>
          </motion.section> : <p className="instrument-no-attempt">No Application Attempt</p>}

        <div className={`instrument-boundary ${attempt ? 'boundary-engaged' : ''}`} aria-label="Execution boundary">
          <motion.i aria-hidden="true" layout initial={false} transition={motionTokens.causal} />
          <span>Execution boundary</span><strong>{boundaryState}</strong>
        </div>
      </div>

      <motion.section
        className="instrument-truth"
        aria-label="Operational truth"
        initial={false}
        animate={{ opacity: attempt ? 1 : 0.86, scale: attempt ? 1 : 0.995 }}
        transition={attempt ? motionTokens.causal : motionTokens.settle}
      >
        <p className="instrument-label">Operational truth</p>
        <h3>{operationalTruthSummary}</h3>
        {operationalTruth}
      </motion.section>

      <motion.section
        className="instrument-outcome"
        aria-label="Why this disposition"
        initial={false}
        animate={{ opacity: disposition === 'NOT RESOLVED' ? 0.78 : 1, y: 0 }}
        transition={motionTokens.reveal}
      >
        <span>Broker outcome</span><strong>{disposition}</strong><p>{why}</p>
        {effects ? <small>{effects}</small> : null}
      </motion.section>
    </section>
  </MotionConfig>;
});
