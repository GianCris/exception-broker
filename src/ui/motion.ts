export const motionTokens = {
  reveal: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] },
  settle: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
  causal: { duration: 0.56, ease: [0.2, 0.7, 0.2, 1] },
} as const;

/**
 * The one consequential moment in Control, in milliseconds from the reviewed APPLY.
 * Each stage is offset by the stage that caused it, so the sequence reads as causality:
 * the review is confirmed, an Application Attempt exists, the boundary engages once,
 * operational reality is measured, the required/available relationship resolves, and the
 * Broker answers. The Broker result is already known synchronously — nothing here delays
 * correctness, aria-live state or the ability to act; it only presents the transition.
 */
export const applyStages = {
  review: 0,
  attempt: 130,
  boundary: 260,
  reality: 400,
  resolve: 530,
  disposition: 650,
} as const;
