/**
 * How the Interactive Demo teaches — deliberately separate from what happened.
 *
 * guidedScenario.ts owns the operational facts. This module owns only instruction: the
 * story told at each step, which real control the step points at, and which action the
 * learner has to actually perform. Rewriting a sentence here must never require touching a
 * business fact, and adding a fact there must never require touching a step.
 *
 * That boundary is why the story carries TOKENS rather than numbers. A sentence may need
 * to say how many units the customer asked for, but this module must never be the place
 * that decides what that number is — the surface interpolates it from the canonical facts,
 * so a scenario change can never leave the teaching copy quietly lying.
 *
 * There are exactly six instructional moments. This is not a tooltip tour.
 */

/** Stable semantic handles for the real controls the story points at. */
export type GuidedTarget =
  | 'conversation' | 'decision' | 'continue-control'
  | 'review-proposal' | 'apply-reviewed' | 'disposition';

/** Which stage of the product the learner is standing in. */
export type GuidedStage = 'acquisition' | 'control';

/**
 * Passive steps accept a Continue control, which the central story coach renders. An
 * interactive step's label and cue are INSTRUCTION only: the coach states them and the
 * learner advances by operating the real product control, never by the coach auto-advancing
 * and never by a second button that stands in for the real one.
 */
export type GuidedRequiredAction =
  | Readonly<{ kind: 'ACKNOWLEDGE'; label: string }>
  | Readonly<{ kind: 'REAL_ACTION'; label: string; cue: string }>
  | Readonly<{ kind: 'NONE' }>;

/**
 * What the learner is told, in commercial language, at the place they are already looking.
 *
 * `lines` are the story; `takeaway` is the one idea to keep. Either may contain the tokens
 * {total}, {date}, {substitutes} and {available}, which the surface resolves from the
 * scenario's canonical facts. No number is ever written here.
 */
export type GuidedStory = Readonly<{
  eyebrow: string;
  lines: readonly string[];
  takeaway?: string;
}>;

export type GuidedStepId = 'conversation' | 'decision' | 'handoff' | 'review' | 'apply' | 'outcome';

export type GuidedWalkthroughStep = Readonly<{
  stepId: GuidedStepId;
  /** 1-based, for the progress map and "Step N of 6". */
  index: number;
  stage: GuidedStage;
  /** The short orientation label the rail carries. The story itself is told centrally. */
  title: string;
  story: GuidedStory;
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
    title: 'Read the conversation',
    story: {
      eyebrow: 'Step 1 · Read the conversation',
      lines: [
        'A customer needs {total} units by {date}.',
        'CALL-E asks what recovery plan the customer is willing to approve. Read what they actually agree to.',
      ],
      takeaway: 'Exception Broker captures the decision. It does not treat the conversation as permission to act.',
    },
    spotlightTarget: 'conversation',
    requiredAction: { kind: 'ACKNOWLEDGE', label: 'Continue' },
    nextStep: 'decision',
  },
  {
    stepId: 'decision', index: 2, stage: 'acquisition',
    title: 'Decision acquired',
    story: {
      eyebrow: 'Step 2 · Decision acquired',
      lines: [
        'The customer said yes. The decision is now APPROVED.',
        'Exception Broker fixed exactly what was agreed.',
      ],
      takeaway: 'APPROVED means the decision is usable. It does not mean the system should act.',
    },
    spotlightTarget: 'decision',
    requiredAction: { kind: 'ACKNOWLEDGE', label: 'Continue' },
    nextStep: 'handoff',
  },
  {
    stepId: 'handoff', index: 3, stage: 'acquisition',
    title: 'Hand the decision to Control',
    story: {
      eyebrow: 'Step 3 · Your turn',
      lines: ['Send this exact decision to Control.'],
      takeaway: guidedHandoffTeaching,
    },
    spotlightTarget: 'continue-control',
    requiredAction: { kind: 'REAL_ACTION', label: 'Continue to Control', cue: 'Use Continue to Control' },
    teachingNote: guidedHandoffTeaching,
    nextStep: 'review',
  },
  {
    stepId: 'review', index: 4, stage: 'control',
    title: 'Confirm what was agreed',
    story: {
      eyebrow: 'Step 4 · Your turn',
      lines: [
        'Confirm exactly what was agreed.',
        'Before Exception Broker evaluates anything, review the exact decision that will be checked against reality.',
      ],
      takeaway: guidedHandoffTeaching,
    },
    spotlightTarget: 'review-proposal',
    requiredAction: { kind: 'REAL_ACTION', label: 'Review exact proposal', cue: 'Open Review exact proposal' },
    teachingNote: guidedHandoffTeaching,
    nextStep: 'apply',
  },
  {
    stepId: 'apply', index: 5, stage: 'control',
    title: 'Ask what reality allows',
    story: {
      eyebrow: 'Step 5 · Your turn',
      lines: [
        'Ask Exception Broker if this can actually happen.',
        'This does not execute anything. It checks the reviewed decision against what is actually available.',
      ],
    },
    spotlightTarget: 'apply-reviewed',
    requiredAction: { kind: 'REAL_ACTION', label: 'Apply reviewed decision', cue: 'Apply the reviewed decision' },
    nextStep: 'outcome',
  },
  {
    stepId: 'outcome', index: 6, stage: 'control',
    title: 'The result',
    story: {
      eyebrow: 'Step 6 · Result',
      lines: [
        'The decision stayed APPROVED. Its application was BLOCKED.',
        '{substitutes} substitutes were required. Only {available} were available.',
        'Exception Broker stopped the application before an approved decision could become an unsafe action.',
      ],
      takeaway: 'Authority is sufficient. Physical supply is not.',
    },
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

/** Where the learner stands, for the progress map. Behind, here, or still ahead. */
export type GuidedProgressState = 'completed' | 'current' | 'future';
export const guidedProgressState = (index: number, current: number): GuidedProgressState =>
  index < current ? 'completed' : index === current ? 'current' : 'future';

/** The two honest exits, plus the quiet restart. Completion is never persisted. */
export const guidedCompletionActions = {
  live: { label: 'Try live acquisition', detail: 'Run a real CALL-E acquisition with your own provider account.' },
  proof: { label: 'Explore Control proof', detail: 'Inspect the deterministic H01 / H02 / H03 cases and their dispositions.' },
  restart: { label: 'Restart demo', detail: 'Start again from the simulated conversation.' },
} as const;
