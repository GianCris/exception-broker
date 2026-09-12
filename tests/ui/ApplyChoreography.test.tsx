// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProofExperience } from '../../src/ui/ProofExperience.js';
import { prepareProof, reviewProof } from '../../src/demo/proofDemo.js';
import { applyStages, motionTokens } from '../../src/ui/motion.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); });

const Control = () => <ProofExperience prepare={prepareProof} review={reviewProof} />;
const openReview = () => fireEvent.click(screen.getByRole('button', { name: 'Review exact proposal' }));
const applyReviewed = () => { openReview(); fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed decision' })); };
const model = () => screen.getByRole('region', { name: 'Decision control model' });

describe('Application choreography', () => {
  it('sequences the stages by causality and finishes the whole moment under 900ms', () => {
    const order = [applyStages.review, applyStages.attempt, applyStages.boundary, applyStages.reality, applyStages.resolve, applyStages.disposition];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
    expect(applyStages.review).toBe(0);
    // The last stage plus its own transition is the whole moment.
    expect(applyStages.disposition + 240).toBeLessThanOrEqual(900);
    // Individual transitions stay in the restrained band.
    expect(motionTokens.reveal.duration).toBeLessThanOrEqual(0.24);
  });

  it('reveals the already-known Broker result without waiting for any animation', () => {
    render(<Control />);
    applyReviewed();
    // No timers advanced: truth is on screen the moment the Broker answers.
    expect(within(model()).getByText('BLOCK', { exact: true })).toBeVisible();
    expect(within(model()).getByText('EVALUATED')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    expect(screen.getByText(/^Broker disposition BLOCK\./)).toBeInTheDocument();
  });

  it('keeps the acquired decision the same fixed object through the transition', () => {
    render(<Control />);
    const before = within(model()).getByRole('heading', { name: 'APPROVED' });
    applyReviewed();
    // Same DOM node, same text, same semantic colour class: it never travels or restyles.
    const after = within(model()).getByRole('heading', { name: 'APPROVED' });
    expect(after).toBe(before);
    expect(after.closest('.control-decision')).not.toHaveClass('decision-unavailable');
    expect(within(model()).getByRole('region', { name: 'Decision fixed' })).not.toHaveTextContent('BLOCK');
  });

  it('animates only opacity and safe transforms, and collapses to nothing under reduced motion', () => {
    const source = readFileSync('src/ui/ControlInstrument.tsx', 'utf8');
    // Reduced motion means no delay and no duration: the resolved state reads immediately.
    expect(source).toMatch(/useReducedMotion/);
    expect(source).toMatch(/reduced\s*\n?\s*\?\s*\{ duration: 0 \}/);
    // The decision object is the one thing with no entry animation at all.
    expect(source).toMatch(/aria-label="Decision fixed" initial=\{false\}/);
    // No layout property is ever animated, so the camera and the chassis cannot move.
    const animated = [...source.matchAll(/(?:initial|animate)=\{\{([^}]*)\}\}/g)].map((match) => match[1]!);
    expect(animated.length).toBeGreaterThan(4);
    for (const properties of animated) {
      expect(properties).not.toMatch(/\b(height|width|margin|padding|top|left|right|bottom|flex|gap)\b/);
    }
    // No looping, springing or celebratory motion anywhere in the instrument.
    expect(source).not.toMatch(/repeat:|Infinity|type: 'spring'|type: "spring"/);
  });

  it('changes case as a camera-stable change of subject', () => {
    const source = readFileSync('src/ui/ControlInstrument.tsx', 'utf8');
    expect(source).toMatch(/key=\{sceneKey\}/);
    render(<Control />);
    fireEvent.click(screen.getByRole('button', { name: /^H03 \// }));
    // The instrument is re-subjected, not re-laid-out: same region, new case.
    expect(within(model()).getByText('NO REVIEWABLE DECISION')).toBeVisible();
    expect(within(model()).getByText('NOT AVAILABLE')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
  });
});
