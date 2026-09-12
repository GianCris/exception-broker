import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, MotionConfig } from 'motion/react';

import { prepareProof, reviewProof } from '../demo/proofDemo.js';
import { guidedCompletionActions, guidedFirstStepId, guidedStep, guidedStepCount, type GuidedStepId, type GuidedTarget, type GuidedWalkthroughStep } from '../walkthrough/guidedFlow.js';
import { guidedScenario } from '../walkthrough/guidedScenario.js';
import { motionTokens } from './motion.js';
import { ProductTopbar, SentinelScene, SurfaceContext } from './ProductShell.js';
import { ProofExperience } from './ProofExperience.js';
import { TranscriptDocument, type SpeakerName } from './TranscriptDocument.js';
import '../styles/walkthrough.css';

/**
 * The INTERACTIVE DEMO — the guided walkthrough route, under the one name the product uses
 * for learning. A third product mode, next to live Acquisition and the deterministic
 * Control proof, and never blurred with either.
 *
 * It teaches one thing by making the learner do it: a conversation can acquire a decision,
 * the decision can be APPROVED, and APPROVED is still not authority to execute — the exact
 * decision has to be reviewed and its application evaluated against operational reality,
 * which can block it.
 *
 * What it does NOT do: contact CALL-E, construct or call an acquisition API, touch live
 * acquisition or Live Control storage, or implement a second Broker. Steps 1-3 present the
 * simulated scenario in Acquisition's own documentary language; steps 4-6 hand over to the
 * real Control experience running the real deterministic H02 evaluation. The BLOCK the
 * learner sees is produced by the Broker, never by the scenario's expected value.
 *
 * All walkthrough state is ephemeral: nothing is persisted, and every entry or restart
 * begins at step 1 with fresh deterministic state.
 */

export const walkthroughHash = '#walkthrough';
const scenario = guidedScenario;
const facts = scenario.canonicalFacts;
const turnCount = scenario.conversationTurns.length;

/** The caller is simulated and says so, every time it speaks. */
const guidedSpeaker: SpeakerName = (speaker) => speaker === 'bot' ? 'CALL-E · simulated' : speaker === 'user' ? 'Recipient · simulated' : 'Unknown speaker';

const iconAttrs = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const IconWaveform = () => <svg {...iconAttrs}><path d="M4 10v4M8 6v12M12 3v18M16 6v12M20 10v4" /></svg>;
const IconEvidence = () => <svg {...iconAttrs}><path d="M7 3.5h7l3 3v13.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z" /><path d="M14 3.5V7h3" /><path d="M9 12h6M9 15.5h6M9 8.5h3" /></svg>;
const IconDecision = () => <svg {...iconAttrs}><path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" /></svg>;
const Arrow = () => <svg className="acq-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;

/** The persistent provenance indicator. Present at every step, in both stages. */
const guidedContext = (
  <SurfaceContext label="Interactive demo" detail="Simulated conversation · deterministic scenario"
    ariaLabel="Interactive demo: simulated conversation and a deterministic scenario. No provider was contacted and no external execution occurs." />
);

/**
 * The guided Control stage's own context, replacing the proof-case block.
 *
 * Steps 4-6 run the real deterministic H02 evaluation, and outside the walkthrough Control
 * correctly describes that input as a configured proof case. Inside the walkthrough that
 * same sentence would read as though the acquired decision had been thrown away and an
 * unrelated case loaded instead — so here the surface states both truths at once: the
 * acquisition the learner just watched was simulated, and the evaluation it is being put
 * through is the real deterministic one. The decision moved forward; what can be done with
 * it is established somewhere else.
 */
const guidedCaseContext = (
  <section className="control-context guided-case-context" aria-label="Interactive demo case context">
    <b>Demo</b>
    <h2>The decision you just acquired</h2>
    <small>Guided simulated acquisition <span aria-hidden="true">·</span> deterministic H02 evaluation</small>
    <strong>Operational truth is checked independently</strong>
  </section>
);

/** The Decision object's provenance line, for the same reason. */
const guidedDecisionSource = {
  label: 'Guided simulated acquisition',
  detail: 'Deterministic H02 evaluation · not a live CALL-E acquisition',
} as const;

/**
 * Points the coach at a real control without replacing it: the target element is marked so
 * CSS can draw one restrained ring. Re-runs per step, and retries for a few frames because
 * some targets (the review sheet's action) mount with the step that spotlights them.
 */
const useGuidedSpotlight = (target: GuidedTarget | null) => {
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    let marked: Element | null = null;
    const clear = () => { for (const node of document.querySelectorAll('[data-walkthrough-active]')) node.removeAttribute('data-walkthrough-active'); };
    const assign = () => {
      clear();
      if (target === null) return;
      marked = document.querySelector(`[data-walkthrough-target="${target}"]`);
      if (marked !== null) { marked.setAttribute('data-walkthrough-active', 'true'); return; }
      if (attempts++ < 8) frame = requestAnimationFrame(assign);
    };
    assign();
    return () => { cancelAnimationFrame(frame); clear(); };
  }, [target]);
};

type CoachProps = Readonly<{
  step: GuidedWalkthroughStep; discarded: boolean; disposition: string | null;
  onSkip: () => void; onRestart: () => void;
  onTryLive: () => void; onExploreProof: () => void;
}>;

/**
 * The coach lives in the product's own branded rail rather than floating over the
 * interface, so it can never cover the action it is pointing at and never dims the product.
 *
 * It carries identity, progress, the concept and the two quiet exits — and deliberately no
 * progression control at all. Progression belongs to the Action Beacon, so at any moment
 * there is exactly one thing to click and it is never hidden beside the product.
 */
const GuidedCoach = ({ step, discarded, disposition, onSkip, onRestart, onTryLive, onExploreProof }: CoachProps) => {
  const heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step.stepId]);
  const complete = step.stepId === 'outcome';
  return <div className="guided-coach" aria-label="Interactive demo coach">
    <p className="eyebrow">Interactive demo</p>
    <p className="guided-progress" aria-live="polite" tabIndex={-1} ref={heading}>Step {step.index} of {guidedStepCount}</p>
    <MotionConfig reducedMotion="user">
      <motion.div key={`${step.stepId}-${discarded ? 'discarded' : 'active'}`} className="guided-coach-body"
        initial={{ opacity: 0.35, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionTokens.reveal, duration: 0.2 }}>
        <h2>{discarded ? 'The proposal was discarded' : step.title}</h2>
        <p>{discarded
          ? 'Discarding closes this exact proposal, so there is nothing left to apply — a real and correct outcome. Restart the demo to see what the Broker answers instead.'
          : step.coachCopy}</p>
        {/* The rail explains; it never holds the progression action. Exactly one control
            advances a passive step and it is the central Action Beacon, so a first-time
            learner never has to find a button hidden beside the product. */}
        {discarded || step.teachingNote === undefined ? null : <p className="guided-teaching">{step.teachingNote}</p>}
        {complete ? <div className="guided-summary">
          {/* The decision and the disposition are read back from what Control rendered; the
              walkthrough never states an outcome of its own. The middle row names the
              Broker's disposition, because it is the Broker that answered — the application
              is the thing that was blocked, it is not itself a BLOCK. */}
          <dl>
            <div><dt>Decision</dt><dd>{scenario.normalizedDecision}</dd></div>
            <div><dt>Broker disposition</dt><dd>{disposition ?? 'NOT EVALUATED'}</dd></div>
            <div><dt>External execution</dt><dd>NONE</dd></div>
          </dl>
          <button type="button" className="guided-next" onClick={onTryLive}>{guidedCompletionActions.live.label} <Arrow /></button>
          <button type="button" className="guided-secondary" onClick={onExploreProof}>{guidedCompletionActions.proof.label}</button>
        </div> : null}
      </motion.div>
    </MotionConfig>
    <div className="guided-coach-foot">
      <button type="button" className="guided-quiet" onClick={onRestart}>{guidedCompletionActions.restart.label}</button>
      {complete ? null : <button type="button" className="guided-quiet" onClick={onSkip}>Skip demo</button>}
    </div>
  </div>;
};

/**
 * The Action Beacon: what to do next, where the learner is already looking.
 *
 * A first-time user must never have to hunt for the next action, so the beacon sits in the
 * lower centre of the workspace — inside the stable camera, clear of the transcript, the
 * evidence and the decision payoff — and it changes meaning with the step:
 *
 *   passive steps (1, 2)  the beacon IS the progression control, and the only one
 *   real-action steps (3, 4, 5)  the beacon is INSTRUCTION, and the real product control
 *                                remains the only thing that advances anything
 *   the outcome step (6)  there is no beacon; the consequence is the protagonist
 *
 * That distinction is the whole point: a tutorial button that stands in for Continue to
 * Control, Review exact proposal or Apply reviewed decision would teach a product the user
 * has not actually used. So on those steps the beacon renders no button at all — it names
 * the real control, which wears the same plum spotlight, and the learner goes and uses it.
 *
 * The treatment is a static luminous edge and one short entrance settle. Nothing loops,
 * blinks or bounces, and reduced motion removes the entrance without removing the beacon.
 */
const GuidedActionBeacon = ({ step, discarded, onContinue }: Readonly<{
  step: GuidedWalkthroughStep; discarded: boolean; onContinue: () => void;
}>) => {
  const action = step.requiredAction;
  if (discarded || action.kind === 'NONE') return null;
  const instructional = action.kind === 'REAL_ACTION';
  // The dock owns the placement and the card owns the treatment: the entrance transform
  // belongs to the card, so it can never fight the centring the dock is responsible for.
  return <MotionConfig reducedMotion="user">
    <div className="guided-beacon-dock">
      <motion.div key={step.stepId} className={`guided-beacon${instructional ? ' guided-beacon--instruction' : ''}`}
        aria-label="Interactive demo next action"
        initial={{ opacity: 0.3, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionTokens.reveal, duration: 0.2 }}>
        {/* Points back up at the product the beacon is talking about. Decorative only. */}
        <i className="beacon-link" aria-hidden="true" />
        {instructional
          ? <p className="beacon-instruction"><b>Your turn</b><strong>{action.label} <span aria-hidden="true">→</span></strong><span>{action.hint}</span></p>
          : <button type="button" className="beacon-action" onClick={onContinue}>{action.label} <Arrow /></button>}
      </motion.div>
    </div>
  </MotionConfig>;
};

/** Steps 1-3: the simulated scenario, in Acquisition's documentary language. */
const GuidedAcquisitionStage = ({ step, coach, beacon, onContinue }: Readonly<{ step: GuidedWalkthroughStep; coach: ReactNode; beacon: ReactNode; onContinue: () => void }>) => (
  <main className="acq-page">
    <div className="acq-layout">
      <aside className="acq-rail guided-rail" aria-label="Interactive demo">
        <div className="acq-rail-top">{coach}</div>
        <div className="acq-rail-scene" aria-hidden="true"><div className="acq-rail-motif"><q>Higher ground is a choice.</q><span>— The Sentinel</span></div></div>
      </aside>
      {/* Step 1 is about the conversation, so everything the conversation has not caused
          yet stays truthfully dormant rather than pre-announcing step 2's payoff. Nothing
          is hidden and no fact is altered: the panels keep their place and their real
          status, and only their visual weight waits its turn. */}
      <div className="acq-main guided-main" data-guided-reveal={step.index >= 2 ? 'decision' : 'conversation'}>
        <header className="acq-interaction-band">
          <div>
            <p className="acq-eyebrow">Simulated interaction <span className="acq-inline-status is-active">● SIMULATED</span></p>
            <h1 className="acq-title-shift">Short physical supply</h1>
            <p>A written conversation for one deterministic scenario. No provider was contacted and no call was placed.</p>
          </div>
          <dl>
            <div><dt>Source</dt><dd>Simulated</dd></div>
            <div><dt>Requested</dt><dd>{facts.requestedTotalUnits} units</dd></div>
            <div><dt>Target date</dt><dd>{facts.targetDeliveryLabel}</dd></div>
            <div><dt>Case</dt><dd>{facts.caseId}</dd></div>
          </dl>
        </header>
        <div className="acq-document-grid">
          <section className="acq-panel acq-conversation" data-walkthrough-target="conversation" aria-labelledby="guided-conversation-title">
            <header>
              <span className="acq-panel-icon" aria-hidden="true"><IconWaveform /></span>
              <div><h2 id="guided-conversation-title">Conversation</h2><p>{turnCount} simulated turns. Nothing was returned by a provider.</p></div>
              <span className="acq-inline-status is-active">SIMULATED</span>
            </header>
            <div className="acq-transcript"><div className="acq-transcript-scroll">
              <TranscriptDocument turns={scenario.conversationTurns} keyPrefix="guided" name={guidedSpeaker} />
            </div></div>
          </section>
          <section className="acq-panel acq-evidence-formation">
            <div className="acq-evidence-block">
              <header>
                <span className="acq-panel-icon" aria-hidden="true"><IconEvidence /></span>
                <div><h2>Simulated provider evidence</h2><p>{scenario.simulatedProviderEvidence.length} written items, not observed.</p></div>
              </header>
              <ol>{scenario.simulatedProviderEvidence.map((item, index) => <li key={index}><b>{String(index + 1).padStart(2, '0')}</b><span>{item}</span></li>)}</ol>
            </div>
            <div className="acq-formation">
              <header>
                <span className="acq-panel-icon" aria-hidden="true"><IconDecision /></span>
                <div><h2>Decision formation</h2><p>Simulated result to Exception Broker normalization.</p></div>
              </header>
              <ol>
                <li className="is-done"><span>1</span><div><strong>Simulated structured result</strong><small>Written for this scenario</small><b className="acq-state">AVAILABLE</b></div></li>
                <li className={step.index >= 2 ? 'is-done' : 'is-waiting'}><span>2</span><div><strong>Exception Broker normalization</strong><small>Result checked for usability</small><b className="acq-state">{step.index >= 2 ? 'USABLE' : 'PENDING'}</b></div></li>
                <li className={step.index >= 3 ? 'is-ready' : 'is-locked'}><span>3</span><div><strong>Control eligibility</strong><small>Exact review stays separate</small><b className="acq-state">{step.index >= 3 ? 'READY FOR REVIEW' : 'LOCKED'}</b></div></li>
              </ol>
              <p>The structured result supplies the decision. Exception Broker does not infer a decision from transcript text.</p>
            </div>
          </section>
        </div>
        {step.index >= 2 ? <section className="acq-resolution is-ready" data-walkthrough-target="decision" aria-label="Acquired decision">
          <div className="acq-resolution-mark" aria-hidden="true"><IconDecision /></div>
          <div>
            <p className="acq-eyebrow">Decision acquired</p>
            <h2>{scenario.normalizedDecision}</h2>
            <p>CALL-E · Simulated conversation</p>
          </div>
          <div className="acq-resolution-copy">
            <strong>Acquired decision ≠ execution authority.</strong>
            <span>{scenario.simulatedStructuredResult.summary} The decision is fixed and available for exact human review in Control. No review, application or external execution has occurred.</span>
            <small>✓ Simulated result normalized &nbsp; ✓ Decision fixed &nbsp; ○ Not yet reviewed</small>
            <b>READY FOR REVIEW</b>
          </div>
          {step.index >= 3 ? <div className="acq-resolution-action">
            <button type="button" data-walkthrough-target="continue-control" onClick={onContinue}>Continue to Control <Arrow /></button>
            <small>Handoff preserves the evidence chain</small>
          </div> : <div className="acq-resolution-action guided-resolution-wait"><small>Continue to Control is the next step.</small></div>}
        </section> : null}
      </div>
    </div>
    {beacon}
  </main>
);

/** Skip leaves honestly: it never pretends the walkthrough was completed. */
const GuidedExit = ({ onTryLive, onExploreProof, onHome, onRestart }: Readonly<{ onTryLive: () => void; onExploreProof: () => void; onHome: () => void; onRestart: () => void }>) => (
  <main className="acq-page guided-exit-page">
    <section className="guided-exit" aria-labelledby="guided-exit-title">
      <p className="eyebrow">Interactive demo</p>
      <h1 id="guided-exit-title">Demo skipped</h1>
      <p>You left before the Broker evaluated the application, so nothing was demonstrated and nothing was recorded. Pick where to go next.</p>
      <div className="guided-exit-actions">
        <button type="button" className="guided-next" onClick={onTryLive}>{guidedCompletionActions.live.label} <Arrow /></button>
        <button type="button" className="guided-secondary" onClick={onExploreProof}>{guidedCompletionActions.proof.label}</button>
        <button type="button" className="guided-secondary" onClick={onHome}>Return home</button>
      </div>
      <button type="button" className="guided-quiet" onClick={onRestart}>{guidedCompletionActions.restart.label}</button>
    </section>
  </main>
);

/**
 * Primary Control navigation leaves the walkthrough for the real Control WORKSPACE, while
 * "Explore Control proof" opens the deterministic verification surface. They are different
 * destinations, so they are different props: the walkthrough must never turn its own exit
 * into the other one.
 */
export const GuidedWalkthroughExperience = ({ onNavigateHome, onNavigateAcquisition, onNavigateControl, onNavigateControlProof }: Readonly<{
  onNavigateHome: () => void;
  onNavigateAcquisition: () => void;
  onNavigateControl: () => void;
  onNavigateControlProof: () => void;
}>) => {
  const [stepId, setStepId] = useState<GuidedStepId>(guidedFirstStepId);
  const [runId, setRunId] = useState(0);
  const [discarded, setDiscarded] = useState(false);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const step = guidedStep(stepId);
  useGuidedSpotlight(skipped ? null : step.spotlightTarget);

  const advance = (from: GuidedStepId) => {
    const current = guidedStep(from);
    if (current.nextStep !== undefined) setStepId(current.nextStep);
  };
  const restart = () => { setStepId(guidedFirstStepId); setDiscarded(false); setDisposition(null); setSkipped(false); setRunId((value) => value + 1); };
  const coach = <GuidedCoach step={step} discarded={discarded} disposition={disposition}
    onSkip={() => setSkipped(true)} onRestart={restart}
    onTryLive={onNavigateAcquisition} onExploreProof={onNavigateControlProof} />;
  // One beacon definition for both stages: the passive steps advance through it, the
  // real-action steps only read from it, and step 6 renders none.
  const beacon = <GuidedActionBeacon step={step} discarded={discarded} onContinue={() => advance(stepId)} />;

  if (skipped) {
    return <div className="acquisition-shell guided-shell">
      <ProductTopbar surface="walkthrough" onNavigateHome={onNavigateHome} onNavigateAcquisition={onNavigateAcquisition} onNavigateControl={onNavigateControl} context={guidedContext} />
      <GuidedExit onTryLive={onNavigateAcquisition} onExploreProof={onNavigateControlProof} onHome={onNavigateHome} onRestart={restart} />
    </div>;
  }

  if (step.stage === 'acquisition') {
    return <div className="acquisition-shell guided-shell">
      <ProductTopbar surface="walkthrough" onNavigateHome={onNavigateHome} onNavigateAcquisition={onNavigateAcquisition} onNavigateControl={onNavigateControl} context={guidedContext} />
      <GuidedAcquisitionStage step={step} coach={coach} beacon={beacon} onContinue={() => advance('handoff')} />
    </div>;
  }

  // Steps 4-6 are the real Control experience on real deterministic H02 state. The
  // walkthrough supplies only the guided rail, the provenance label and completion hooks;
  // the Decision, the Exact Review sheet, the Application Boundary, Operational Reality,
  // the Broker disposition and the APPLY choreography are all Control's own.
  return <div className="guided-control" key={runId}>
    <ProofExperience
      prepare={prepareProof} review={reviewProof} initialScenario={scenario.operationalContext.controlScenario}
      onNavigateHome={onNavigateHome} onNavigateAcquisition={onNavigateAcquisition} onNavigateControl={onNavigateControl}
      walkthrough={{
        context: guidedContext,
        caseContext: guidedCaseContext,
        decisionSource: guidedDecisionSource,
        rail: <aside className="control-queue guided-rail" aria-label="Interactive demo">
          <div className="queue-top">{coach}</div>
          <SentinelScene />
        </aside>,
        onReviewOpen: () => { if (stepId === 'review') advance('review'); },
        onReviewResolved: (action, brokerDisposition) => {
          if (action === 'DISCARD') { setDiscarded(true); return; }
          setDisposition(brokerDisposition);
          if (stepId === 'apply') advance('apply');
        },
      }}
    />
    {beacon}
  </div>;
};
