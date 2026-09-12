// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { App } from '../../src/App.js';
import { GuidedWalkthroughExperience, walkthroughHash } from '../../src/ui/GuidedWalkthroughExperience.js';
import { controlSessionStorageKey } from '../../src/ui/LiveControlExperience.js';
import { guidedScenario } from '../../src/walkthrough/guidedScenario.js';
import { guidedStepCount, guidedWalkthroughSteps } from '../../src/walkthrough/guidedFlow.js';

const facts = guidedScenario.canonicalFacts;
const setHash = (hash: string) => { window.history.replaceState(null, '', hash === '' ? '/' : hash); };

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setHash(''); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setHash(''); });

const Walkthrough = () => <GuidedWalkthroughExperience onNavigateHome={vi.fn()} onNavigateAcquisition={vi.fn()} onNavigateControl={vi.fn()} onNavigateControlProof={vi.fn()} />;
const progress = () => screen.getByText(/^Step \d of 6$/).textContent;
/**
 * The teaching layer writes {tokens} and the scenario owns the facts, so the tests resolve
 * them the same way the surface does — a copy edit can never make these assertions pass
 * against a sentence the learner would not actually read.
 */
const resolve = (line: string) => line
  .replaceAll('{total}', String(facts.requestedTotalUnits))
  .replaceAll('{date}', facts.targetDeliverySpoken)
  .replaceAll('{substitutes}', String(facts.substituteUnits))
  .replaceAll('{available}', String(facts.availableSubstitutes));

/** The rail orients; the coach narrates in the workspace. Two surfaces, two jobs. */
const rail = () => screen.getByLabelText('Interactive demo orientation');
const coach = () => screen.getByLabelText('Interactive demo step guidance');
const target = (name: string) => document.querySelector(`[data-walkthrough-target="${name}"]`) as HTMLElement;
const next = () => fireEvent.click(within(coach()).getByRole('button', { name: /^Continue/ }));
const provenance = () => screen.getByLabelText(/Interactive demo: simulated conversation and a deterministic scenario/i);

/** Walks the whole six-step flow the way a learner does, with the real controls. */
const runToOutcome = () => {
  next(); next();
  fireEvent.click(target('continue-control'));
  fireEvent.click(target('review-proposal'));
  fireEvent.click(target('apply-reviewed'));
};

describe('Interactive demo architecture', () => {
  it('depends on no acquisition client, no network and no live storage', () => {
    for (const file of ['src/ui/GuidedWalkthroughExperience.tsx', 'src/walkthrough/guidedScenario.ts', 'src/walkthrough/guidedFlow.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/browserClient|AcquisitionBrowserApi|createAcquisitionBrowserApi/);
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|EventSource|WebSocket/);
      expect(source).not.toMatch(/localStorage|sessionStorage|acquisitionStorageKey|acquisitionAccessKey|controlSessionStorageKey/);
    }
  });

  it('takes no acquisition api and issues no request across the whole walkthrough', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Walkthrough />);
    runToOutcome();
    expect(progress()).toBe('Step 6 of 6');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never writes live acquisition or Live Control state, and never clears a stored session', () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-EXISTING');
    localStorage.setItem('exception-broker-acquisition-id', 'ACQ-EXISTING');
    sessionStorage.setItem('exception-broker-live-access', 'ACCESS-EXISTING');
    const before = JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } });
    render(<Walkthrough />);
    runToOutcome();
    fireEvent.click(within(rail()).getByRole('button', { name: 'Restart demo' }));
    expect(JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })).toBe(before);
  });

  it('declares a simulated source and never an implementation of its own Broker', () => {
    expect(guidedScenario.source).toBe('SIMULATED_GUIDED_SCENARIO');
    const source = readFileSync('src/ui/GuidedWalkthroughExperience.tsx', 'utf8');
    // It composes the existing deterministic proof path rather than re-deciding anything.
    expect(source).toMatch(/prepareProof/);
    expect(source).toMatch(/reviewProof/);
    // No disposition literal anywhere: the outcome is always read back from Control.
    expect(source).not.toMatch(/'BLOCK'|"BLOCK"|>BLOCK<|'ALLOW'|'WAIT'/);
  });
});

describe('Interactive demo storytelling', () => {
  it('tells the story in the workspace, so the rail never has to be read', () => {
    render(<Walkthrough />);
    const seen: string[] = [];
    // Every step 1-5 narrates centrally: which step this is, what is happening, and — where
    // the step has one — the idea to keep. The rail is not consulted at all.
    const readCoach = () => {
      const step = guidedWalkthroughSteps[seen.length]!;
      expect(within(coach()).getByText(step.story.eyebrow)).toBeVisible();
      for (const line of [...step.story.lines, ...(step.story.takeaway === undefined ? [] : [step.story.takeaway])]) {
        expect(within(coach()).getByText(resolve(line))).toBeVisible();
      }
      seen.push(progress()!);
    };
    readCoach(); next();
    readCoach(); next();
    readCoach(); fireEvent.click(target('continue-control'));
    readCoach(); fireEvent.click(target('review-proposal'));
    readCoach();
    expect(seen).toEqual(['Step 1 of 6', 'Step 2 of 6', 'Step 3 of 6', 'Step 4 of 6', 'Step 5 of 6']);
  });

  it('resolves scenario facts into the story instead of restating them in the teaching layer', () => {
    render(<Walkthrough />);
    // The customer's own numbers, read from the scenario — never written into the copy.
    expect(within(coach()).getByText(`A customer needs ${facts.requestedTotalUnits} units by ${facts.targetDeliverySpoken}.`)).toBeVisible();
    expect(coach().textContent).not.toMatch(/\{\w+\}/);
    runToOutcome();
    // And the conclusion states the real shortfall the Broker acted on.
    expect(within(rail()).getByText(`${facts.substituteUnits} substitutes were required. Only ${facts.availableSubstitutes} were available.`)).toBeVisible();
  });

  it('shows a six-node progress map whose state matches the step the learner is on', () => {
    render(<Walkthrough />);
    const nodes = () => [...document.querySelectorAll('.guided-progress-map li')].map((node) => node.className);
    expect(nodes()).toHaveLength(guidedStepCount);
    expect(nodes()).toEqual(['progress-current', ...Array<string>(5).fill('progress-future')]);
    next();
    expect(nodes()).toEqual(['progress-completed', 'progress-current', ...Array<string>(4).fill('progress-future')]);
    next();
    fireEvent.click(target('continue-control'));
    expect(nodes()).toEqual([...Array<string>(3).fill('progress-completed'), 'progress-current', 'progress-future', 'progress-future']);
    fireEvent.click(target('review-proposal'));
    fireEvent.click(target('apply-reviewed'));
    expect(nodes()).toEqual([...Array<string>(5).fill('progress-completed'), 'progress-current']);
  });

  it('keeps the step 5 guidance structurally outside the dimmed product layer', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    fireEvent.click(target('review-proposal'));
    expect(progress()).toBe('Step 5 of 6');
    // The sheet makes the product chassis inert; the coach lives outside it, so the
    // instruction is neither dimmed by the scrim nor trapped behind the dialog.
    const chassis = document.querySelector<HTMLElement>('.control-chassis')!;
    expect(chassis.inert).toBe(true);
    expect(chassis.contains(coach())).toBe(false);
    expect(screen.getByRole('dialog').contains(coach())).toBe(false);
    expect(coach().closest('.guided-control')).not.toBeNull();
  });

  it('names the learning mode in full inside guided Control, never as a bare Demo badge', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    const context = screen.getByRole('region', { name: 'Interactive demo case context' });
    expect(within(context).getByText('Interactive demo')).toBeVisible();
    expect(within(context).queryByText('Demo', { exact: true })).not.toBeInTheDocument();
  });

  it('gives the passive steps exactly one progression control, and it is the story coach', () => {
    render(<Walkthrough />);
    for (const step of ['Step 1 of 6', 'Step 2 of 6'] as const) {
      expect(progress()).toBe(step);
      // The coach owns progression outright: no second Continue hiding in the rail.
      expect(within(coach()).getByRole('button', { name: /^Continue/ })).toBeVisible();
      expect(within(rail()).queryByRole('button', { name: /^Continue|^Next/ })).not.toBeInTheDocument();
      // And the rail keeps only identity, progress, the concept and the quiet exits.
      expect(within(rail()).getAllByRole('button').map((button) => button.textContent))
        .toEqual(['Restart demo', 'Skip demo']);
      next();
    }
    expect(progress()).toBe('Step 3 of 6');
  });

  it('makes the coach instructional on the real-action steps, never a second button', () => {
    render(<Walkthrough />);
    next(); next();
    // Step 3: the coach names the real control and offers nothing to press.
    expect(within(coach()).queryByRole('button')).not.toBeInTheDocument();
    expect(within(coach()).getByText(/Your turn/)).toBeVisible();
    expect(coach().querySelector('strong')).toHaveTextContent('Use Continue to Control');
    expect(progress()).toBe('Step 3 of 6');
    // Clicking the coach itself advances nothing; only the real product control does.
    fireEvent.click(coach());
    expect(progress()).toBe('Step 3 of 6');
    fireEvent.click(target('continue-control'));
    // Step 4 and step 5 keep the same rule, against the real Control surface.
    expect(progress()).toBe('Step 4 of 6');
    expect(within(coach()).queryByRole('button')).not.toBeInTheDocument();
    expect(coach().querySelector('strong')).toHaveTextContent('Open Review exact proposal');
    fireEvent.click(coach());
    expect(progress()).toBe('Step 4 of 6');
    fireEvent.click(target('review-proposal'));
    expect(progress()).toBe('Step 5 of 6');
    expect(within(coach()).queryByRole('button')).not.toBeInTheDocument();
    expect(coach().querySelector('strong')).toHaveTextContent('Apply the reviewed decision');
    fireEvent.click(coach());
    expect(progress()).toBe('Step 5 of 6');
  });

  it('stands down at the outcome so the Broker result is the protagonist', () => {
    render(<Walkthrough />);
    runToOutcome();
    expect(progress()).toBe('Step 6 of 6');
    expect(screen.queryByLabelText('Interactive demo step guidance')).not.toBeInTheDocument();
  });

  it('uses no looping attention animation anywhere in the demo treatment', () => {
    const walkthroughCss = readFileSync('src/styles/walkthrough.css', 'utf8');
    expect(walkthroughCss).toMatch(/\.guided-story \{/);
    // A static luminous edge and one entrance settle — never a pulse, blink or bounce.
    expect(walkthroughCss).not.toMatch(/@keyframes|animation:|infinite/);
    const source = readFileSync('src/ui/GuidedWalkthroughExperience.tsx', 'utf8');
    expect(source).not.toMatch(/repeat:\s*Infinity|repeatType/);
  });
});

describe('Interactive demo flow', () => {
  it('starts at step one and keeps six instructional moments', () => {
    render(<Walkthrough />);
    expect(progress()).toBe('Step 1 of 6');
    expect(within(rail()).getByRole('heading', { level: 2 })).toHaveTextContent(guidedWalkthroughSteps[0]!.title);
  });

  it('advances the two passive steps from the coach and shows the acquired decision', () => {
    render(<Walkthrough />);
    expect(target('decision')).toBeNull();
    next();
    expect(progress()).toBe('Step 2 of 6');
    const decision = target('decision');
    expect(within(decision).getByRole('heading', { name: 'APPROVED' })).toBeVisible();
    expect(within(decision).getByText(/Acquired decision ≠ execution authority/)).toBeVisible();
    // The handoff is the next step's job, so its action is not offered yet.
    expect(target('continue-control')).toBeNull();
  });

  it('requires the real Continue to Control action rather than auto-advancing', () => {
    render(<Walkthrough />);
    next(); next();
    expect(progress()).toBe('Step 3 of 6');
    // Still in the acquisition stage: the coach asked, it did not move on by itself.
    expect(document.querySelector('.control-instrument')).toBeNull();
    fireEvent.click(target('continue-control'));
    expect(progress()).toBe('Step 4 of 6');
    expect(screen.getByRole('region', { name: 'Decision control model' })).toBeVisible();
  });

  it('requires the real review action, which opens the shared exact review sheet', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(progress()).toBe('Step 4 of 6');
    fireEvent.click(target('review-proposal'));
    expect(progress()).toBe('Step 5 of 6');
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Review the client decision' })).toBeVisible();
    expect(within(sheet).getByText(/does not execute externally/)).toBeVisible();
  });

  it('reaches step six only from the real Broker result, and reports it truthfully', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    fireEvent.click(target('review-proposal'));
    expect(progress()).toBe('Step 5 of 6');
    fireEvent.click(target('apply-reviewed'));
    expect(progress()).toBe('Step 6 of 6');
    const model = screen.getByRole('region', { name: 'Decision control model' });
    // The decision never changed; its application was blocked.
    expect(within(model).getByRole('heading', { name: 'APPROVED' })).toBeVisible();
    expect(within(model).getByText('BLOCK', { exact: true })).toBeVisible();
    expect(within(model).getByText(`${facts.substituteUnits - facts.availableSubstitutes} required substitute units are unavailable.`)).toBeVisible();
    expect(within(model).getByText('PLAN_PHYSICALLY_INFEASIBLE')).toBeVisible();
    expect(within(model).getByText('Authority is sufficient. Physical supply is not.')).toBeVisible();
    expect(within(model).getAllByText(/No external execution/).length).toBeGreaterThan(0);
    expect(within(model).queryByText('REJECTED', { exact: true })).not.toBeInTheDocument();
    // The completion summary reads the Broker's own answer back, not a literal of its own.
    const summary = within(rail());
    expect(summary.getByText('Broker disposition').closest('div')).toHaveTextContent('Broker dispositionBLOCK');
    // The application is what was blocked; it is not itself a disposition.
    expect(summary.queryByText('Application', { exact: true })).not.toBeInTheDocument();
    expect(summary.getByText('Decision').closest('div')).toHaveTextContent('DecisionAPPROVED');
    expect(summary.getByText('External execution').closest('div')).toHaveTextContent('External executionNONE');
  });

  it('offers both honest exits at completion and no seventh step', () => {
    const acquisition = vi.fn(); const control = vi.fn();
    render(<GuidedWalkthroughExperience onNavigateHome={vi.fn()} onNavigateAcquisition={acquisition} onNavigateControl={vi.fn()} onNavigateControlProof={control} />);
    runToOutcome();
    expect(screen.queryByLabelText('Interactive demo step guidance')).not.toBeInTheDocument();
    expect(within(rail()).queryByRole('button', { name: 'Skip demo' })).not.toBeInTheDocument();
    fireEvent.click(within(rail()).getByRole('button', { name: /Try live acquisition/ }));
    expect(acquisition).toHaveBeenCalledTimes(1);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Explore Control proof' }));
    expect(control).toHaveBeenCalledTimes(1);
  });

  it('restarts to step one with fresh deterministic state, leaking no prior attempt', () => {
    render(<Walkthrough />);
    runToOutcome();
    expect(progress()).toBe('Step 6 of 6');
    fireEvent.click(within(rail()).getByRole('button', { name: 'Restart demo' }));
    expect(progress()).toBe('Step 1 of 6');
    next(); next();
    fireEvent.click(target('continue-control'));
    // A fresh H02 session: the decision is awaiting review again, with no attempt recorded.
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(target('review-proposal')).not.toBeNull();
  });

  it('skips to an honest exit instead of pretending the walkthrough was completed', () => {
    const home = vi.fn();
    render(<GuidedWalkthroughExperience onNavigateHome={home} onNavigateAcquisition={vi.fn()} onNavigateControl={vi.fn()} onNavigateControlProof={vi.fn()} />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Skip demo' }));
    expect(screen.getByRole('heading', { name: 'Demo skipped' })).toBeVisible();
    expect(screen.getByText(/nothing was demonstrated and nothing was recorded/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Return home' }));
    expect(home).toHaveBeenCalledTimes(1);
  });

  it('keeps a discarded proposal honest rather than claiming a blocked application', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    fireEvent.click(target('review-proposal'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(progress()).toBe('Step 5 of 6');
    expect(within(rail()).getByRole('heading', { name: 'The proposal was discarded' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Decision control model' })).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
  });
});

describe('Interactive demo progressive reveal', () => {
  const stage = () => document.querySelector('.guided-main') as HTMLElement;

  it('keeps step 1 on the conversation without giving away the step 2 payoff', () => {
    render(<Walkthrough />);
    expect(progress()).toBe('Step 1 of 6');
    // The conversation is the subject; everything it has not caused yet is dormant.
    expect(stage()).toHaveAttribute('data-guided-reveal', 'conversation');
    expect(document.querySelector('[data-walkthrough-active="true"]')).toBe(target('conversation'));
    // The APPROVED payoff belongs to step 2 and is not rendered at all yet.
    expect(target('decision')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'APPROVED' })).not.toBeInTheDocument();
    // Dormant is not hidden: the panels keep their place and state nothing false.
    expect(screen.getByRole('heading', { name: 'Simulated provider evidence' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Decision formation' })).toBeVisible();
    expect(screen.getByText('PENDING')).toBeVisible();
    expect(screen.getByText('LOCKED')).toBeVisible();
  });

  it('gives evidence and decision formation their presence at step 2, where APPROVED is earned', () => {
    render(<Walkthrough />);
    next();
    expect(progress()).toBe('Step 2 of 6');
    expect(stage()).toHaveAttribute('data-guided-reveal', 'decision');
    expect(screen.getByText('USABLE')).toBeVisible();
    expect(within(target('decision')).getByRole('heading', { name: 'APPROVED' })).toBeVisible();
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument();
  });

  it('changes no scenario fact between the two reveal states and never self-advances', () => {
    render(<Walkthrough />);
    const factsAtStepOne = screen.getByRole('heading', { name: 'Short physical supply' }).closest('header')!.textContent;
    // Nothing advances on its own: the step only moves when the learner moves it.
    expect(progress()).toBe('Step 1 of 6');
    next();
    expect(screen.getByRole('heading', { name: 'Short physical supply' }).closest('header')!.textContent).toBe(factsAtStepOne);
    expect(String(factsAtStepOne)).toContain(`${facts.requestedTotalUnits} units`);
  });

  it('keeps the APPROVED decision neutral plum rather than a success colour', () => {
    render(<Walkthrough />);
    next();
    const resolution = target('decision');
    expect(resolution).toHaveClass('acq-resolution');
    expect(resolution.className).not.toMatch(/success|allow|green/i);
    expect(within(resolution).getByText('READY FOR REVIEW')).toBeVisible();
  });
});

describe('Interactive demo story continuity', () => {
  it('carries one teaching idea across the step 3 to step 4 handoff', () => {
    render(<Walkthrough />);
    next(); next();
    expect(progress()).toBe('Step 3 of 6');
    const teaching = 'The decision moves forward. Operational truth is checked independently.';
    expect(within(coach()).getByText(teaching)).toBeVisible();
    fireEvent.click(target('continue-control'));
    expect(progress()).toBe('Step 4 of 6');
    expect(within(coach()).getByText(teaching)).toBeVisible();
  });

  it('describes the guided Control stage as the decision just acquired, evaluated deterministically', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    const context = screen.getByRole('region', { name: 'Interactive demo case context' });
    // Both truths at once: the acquisition was simulated, the evaluation is the real H02.
    expect(within(context).getByRole('heading', { name: 'The decision you just acquired' })).toBeVisible();
    expect(within(context).getByText(/Guided simulated acquisition.*deterministic H02 evaluation/)).toBeVisible();
    expect(within(context).getByText('Operational truth is checked independently')).toBeVisible();
    // The proof-case framing never appears inside the walkthrough.
    expect(screen.queryByRole('region', { name: 'Proof case context' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Configured decision input/)).not.toBeInTheDocument();
    const decision = screen.getByRole('region', { name: 'Decision fixed' });
    expect(within(decision).getByText('Guided simulated acquisition')).toBeVisible();
    expect(within(decision).getByText('Deterministic H02 evaluation · not a live CALL-E acquisition')).toBeVisible();
  });

  it('leaves the normal Control Proof copy untouched outside the walkthrough', () => {
    render(<App />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Control' }));
    fireEvent.click(screen.getByRole('button', { name: /Explore Control proof/ }));
    expect(screen.getByRole('region', { name: 'Proof case context' })).toBeVisible();
    expect(screen.getAllByText('Configured decision input').length).toBeGreaterThan(0);
    expect(screen.getByText('Deterministic proof · not a CALL-E acquisition')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Interactive demo case context' })).not.toBeInTheDocument();
  });
});

describe('Interactive demo provenance', () => {
  it('keeps the simulated label visible at every one of the six steps', () => {
    render(<Walkthrough />);
    const seen: string[] = [];
    const check = () => { expect(provenance()).toBeVisible(); seen.push(progress()!); };
    check(); next();
    check(); next();
    check(); fireEvent.click(target('continue-control'));
    check(); fireEvent.click(target('review-proposal'));
    check(); fireEvent.click(target('apply-reviewed'));
    check();
    expect(seen).toEqual(['Step 1 of 6', 'Step 2 of 6', 'Step 3 of 6', 'Step 4 of 6', 'Step 5 of 6', 'Step 6 of 6']);
  });

  it('never labels guided state as a live acquisition, and marks the caller simulated', () => {
    render(<Walkthrough />);
    expect(screen.getAllByText('CALL-E · simulated').length).toBeGreaterThan(0);
    expect(screen.getByText(/No provider was contacted and no call was placed/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Live acquisition|Observed live|CALL-E completed|provider returned/i);
    next();
    expect(within(target('decision')).getByText('CALL-E · Simulated conversation')).toBeVisible();
  });

  it('never presents the deterministic proof or live context while guiding', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    expect(screen.queryByText('Deterministic proof')).not.toBeInTheDocument();
    expect(screen.queryByText('Live control')).not.toBeInTheDocument();
    expect(provenance()).toBeVisible();
    // The H01/H02/H03 attention queue and the demo-case reset stay out of the walkthrough.
    expect(screen.queryByRole('complementary', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset demo case' })).not.toBeInTheDocument();
  });

  it('marks simulated provider material as simulated and never as observed', () => {
    render(<Walkthrough />);
    expect(screen.getByRole('heading', { name: 'Simulated provider evidence' })).toBeVisible();
    expect(screen.getByText(/written items, not observed/)).toBeVisible();
    expect(screen.getByText('Simulated structured result')).toBeVisible();
  });
});

describe('Interactive demo navigation', () => {
  it('opens directly from the walkthrough hash, taking precedence over a stored live session', () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-EXISTING');
    setHash(walkthroughHash);
    render(<App />);
    expect(screen.getByText('Step 1 of 6')).toBeVisible();
    expect(provenance()).toBeVisible();
    // The stored live session is read for precedence only, never consumed.
    expect(localStorage.getItem(controlSessionStorageKey)).toBe('CONTROL-EXISTING');
  });

  it('claims the hash on entry and releases it when the learner leaves', () => {
    render(<App />);
    expect(window.location.hash).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /Interactive demo/ }));
    expect(window.location.hash).toBe(walkthroughHash);
    expect(screen.getByText('Step 1 of 6')).toBeVisible();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Control' }));
    expect(window.location.hash).toBe('');
    // Primary Control leaves for the Control workspace, never for deterministic proof.
    expect(screen.getByRole('heading', { name: 'Control starts with an acquired decision.' })).toBeVisible();
    expect(screen.queryByText('Deterministic proof')).not.toBeInTheDocument();
  });

  it('marks no primary module active while guiding, and keeps the nav to three modules', () => {
    setHash(walkthroughHash);
    render(<App />);
    const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
    expect(nav.getAllByRole('button').map((button) => button.textContent)).toEqual(['Home', 'Acquisition', 'Control']);
    expect(nav.getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')).toHaveLength(0);
  });

  it('routes Home and Acquisition learning entries to the walkthrough', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'See it in action' }));
    expect(screen.getByText('Step 1 of 6')).toBeVisible();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Acquisition' }));
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Try the interactive demo/ }));
    expect(screen.getByText('Step 1 of 6')).toBeVisible();
  });

  it('leaves Acquire a decision pointing at the live surface', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Acquire a decision' }));
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
  });
});

describe('Interactive demo accessibility', () => {
  it('gives the current step programmatic context and keeps real controls focusable', () => {
    render(<Walkthrough />);
    const step = screen.getByText('Step 1 of 6');
    expect(step).toHaveAttribute('aria-live', 'polite');
    expect(rail()).toHaveAttribute('aria-label', 'Interactive demo orientation');
    const nextButton = within(coach()).getByRole('button', { name: /^Continue/ });
    nextButton.focus();
    expect(nextButton).toHaveFocus();
    expect(nextButton).toHaveAttribute('type', 'button');
    for (const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('type', 'button');
  });

  it('activates the real product controls from the keyboard', () => {
    render(<Walkthrough />);
    next(); next();
    const handoff = target('continue-control');
    handoff.focus();
    expect(handoff).toHaveFocus();
    fireEvent.keyDown(handoff, { key: 'Enter' });
    fireEvent.click(handoff);
    expect(progress()).toBe('Step 4 of 6');
    const reviewButton = target('review-proposal');
    reviewButton.focus();
    expect(reviewButton).toHaveFocus();
  });

  it('keeps the exact review sheet dialog behaviour intact inside the walkthrough', () => {
    render(<Walkthrough />);
    next(); next();
    fireEvent.click(target('continue-control'));
    fireEvent.click(target('review-proposal'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Close exact review' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Escaping the sheet does not fabricate a Broker answer.
    expect(progress()).toBe('Step 5 of 6');
  });

  it('marks exactly one spotlight target per step without touching accessibility semantics', () => {
    render(<Walkthrough />);
    const active = () => document.querySelectorAll('[data-walkthrough-active="true"]');
    expect(active()).toHaveLength(1);
    expect(active()[0]).toBe(target('conversation'));
    expect(active()[0]!.getAttribute('aria-hidden')).toBeNull();
    next();
    expect(active()).toHaveLength(1);
    expect(active()[0]).toBe(target('decision'));
  });
});
