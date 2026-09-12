/**
 * How the Guided Walkthrough teaches — deliberately separate from what happened.
 *
 * guidedScenario.ts owns the operational facts. This module owns only instruction: the
 * coach copy, which real control each step points at, and which action the learner has to
 * actually perform. Rewriting a sentence here must never require touching a business fact,
 * and adding a fact there must never require touching a step.
 *
 * There are exactly six instructional moments. This is not a tooltip tour.
 */

/** Stable semantic handles for the real controls the coach points at. */
export type GuidedTarget =
  | 'conversation' | 'decision' | 'continue-control'
  | 'review-proposal' | 'apply-reviewed' | 'disposition';

/** Which stage of the product the learner is standing in. */
export type GuidedStage = 'acquisition' | 'control';

/**
 * Passive steps accept a Next control. Interactive steps must be advanced by the learner
 * operating the real product control — never by the coach auto-advancing.
 */
export type GuidedRequiredAction =
  | Readonly<{ kind: 'ACKNOWLEDGE'; label: string }>
  | Readonly<{ kind: 'REAL_ACTION'; label: string; hint: string }>
  | Readonly<{ kind: 'NONE' }>;

export type GuidedStepId = 'conversation' | 'decision' | 'handoff' | 'review' | 'apply' | 'outcome';

export type GuidedWalkthroughStep = Readonly<{
  stepId: GuidedStepId;
  /** 1-based, for "Step N of 6". */
  index: number;
  stage: GuidedStage;
  title: string;
  coachCopy: string;
  spotlightTarget: GuidedTarget;
  requiredAction: GuidedRequiredAction;
  /**
   * One teaching idea carried across the handoff, where the story is most easily
   * misread. Steps 3 and 4 are a single causal moment — the acquired decision moves
   * forward, and what can happen to it is then established by something other than the
   * conversation that produced it — so the same idea is stated on both sides of it.
   */
  teachingNote?: string;
  nextStep?: GuidedStepId;
}>;

/** Stated on both sides of the handoff so the transition reads as one move, not two. */
export const guidedHandoffTeaching = 'The decision moves forward. Operational truth is checked independently.';

export const guidedWalkthroughSteps: readonly GuidedWalkthroughStep[] = [
  {
    stepId: 'conversation', index: 1, stage: 'acquisition',
    title: 'A conversation can acquire a decision',
    coachCopy: 'This conversation is simulated, but it is how a decision reaches Exception Broker. Read what the recipient actually committed to — the conversation can produce a decision, and a decision is not execution authority.',
    spotlightTarget: 'conversation',
    requiredAction: { kind: 'ACKNOWLEDGE', label: 'Next' },
    nextStep: 'decision',
  },
  {
    stepId: 'decision', index: 2, stage: 'acquisition',
    title: 'The decision is now fixed',
    coachCopy: 'The conversation produced an APPROVED decision. The decision is now fixed — but APPROVED does not mean execute.',
    spotlightTarget: 'decision',
    requiredAction: { kind: 'ACKNOWLEDGE', label: 'Next' },
    nextStep: 'handoff',
  },
  {
    stepId: 'handoff', index: 3, stage: 'acquisition',
    title: 'Hand the decision to Control',
    coachCopy: 'APPROVED still does not mean execute. Continue to Control to review exactly what was acquired.',
    spotlightTarget: 'continue-control',
    requiredAction: { kind: 'REAL_ACTION', label: 'Continue to Control', hint: 'Use the Continue to Control action to make the handoff yourself.' },
    teachingNote: guidedHandoffTeaching,
    nextStep: 'review',
  },
  {
    stepId: 'review', index: 4, stage: 'control',
    title: 'Review the exact decision',
    coachCopy: 'This is the decision you just acquired, now in Control. Review exactly what it contains before asking the Broker to evaluate its application.',
    spotlightTarget: 'review-proposal',
    requiredAction: { kind: 'REAL_ACTION', label: 'Review exact proposal', hint: 'Open the real exact review sheet to continue.' },
    teachingNote: guidedHandoffTeaching,
    nextStep: 'apply',
  },
  {
    stepId: 'apply', index: 5, stage: 'control',
    title: 'Ask the Broker to evaluate it',
    coachCopy: 'Applying does not execute externally. It asks the Broker to evaluate this exact application attempt against operational reality.',
    spotlightTarget: 'apply-reviewed',
    requiredAction: { kind: 'REAL_ACTION', label: 'Apply reviewed decision', hint: 'Apply the reviewed decision in the sheet to see what the Broker answers.' },
    nextStep: 'outcome',
  },
  {
    stepId: 'outcome', index: 6, stage: 'control',
    title: 'The decision stayed APPROVED. Its application was blocked.',
    coachCopy: 'Operational reality did not support the attempt, so the Broker blocked it. The decision itself never changed, and nothing was executed outside this controlled context.',
    spotlightTarget: 'disposition',
    requiredAction: { kind: 'NONE' },
  },
] as const;

export const guidedStepCount = guidedWalkthroughSteps.length;

export const guidedStep = (stepId: GuidedStepId): GuidedWalkthroughStep => {
  const step = guidedWalkthroughSteps.find((candidate) => candidate.stepId === stepId);
  if (step === undefined) throw new Error(`Unknown guided walkthrough step: ${stepId}`);
  return step;
};

export const guidedFirstStepId: GuidedStepId = guidedWalkthroughSteps[0]!.stepId;

/** The two honest exits, plus the quiet restart. Completion is never persisted. */
export const guidedCompletionActions = {
  live: { label: 'Try live acquisition', detail: 'Run a real CALL-E acquisition with your own provider account.' },
  proof: { label: 'Explore Control proof', detail: 'Inspect the deterministic H01 / H02 / H03 cases and their dispositions.' },
  restart: { label: 'Restart walkthrough', detail: 'Start again from the simulated conversation.' },
} as const;
