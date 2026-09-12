// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { App } from '../../src/App.js';
import { HomeExperience } from '../../src/ui/HomeExperience.js';
import { proofScenarios } from '../../src/demo/proofDemo.js';
import { controlSessionStorageKey } from '../../src/ui/LiveControlExperience.js';

const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('motion/react')>(),
  useReducedMotion: () => motionPreference.reduced,
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); motionPreference.reduced = false; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const nav = () => within(screen.getByRole('navigation', { name: 'Primary navigation' }));

describe('Home product entry', () => {
  it('renders the approved imagery, headline, milestones and real scenario entries without a request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Decisions need guardrails to reach reality.');
    expect(screen.getAllByAltText('Exception Broker logo')[0]).toHaveAttribute('src', '/images/home/exception-broker-logo-transparent.png');
    expect(screen.getByAltText(/Sentinel Ridge:/)).toHaveAttribute('src', '/images/home/sentinel-ridge.png');
    for (const scenario of proofScenarios) expect(screen.getByRole('button', { name: new RegExp(scenario.title) })).toBeVisible();
    expect(screen.getByText('Decision acquired')).toBeVisible();
    expect(screen.getByText('Execution gate')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
  });

  it.each(proofScenarios)('opens the actual $id Control scenario without applying it', ({ id, title }) => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
    expect(screen.getByRole('region', { name: 'Proof case context' })).toHaveTextContent(`Proof case ${id}`);
    expect(screen.getByRole('button', { name: new RegExp(`^${id} /`) })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
    if (id === 'H03') expect(screen.queryByRole('button', { name: 'Review exact proposal' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Decisions need guardrails');
  });

  it('routes Acquisition and Control to real surfaces, and their logos return Home', () => {
    render(<App />);
    fireEvent.click(nav().getByRole('button', { name: 'Acquisition' }));
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    // With nothing acquired, Control is the Control workspace in its honest empty state —
    // never a deterministic proof case standing in for a decision the user does not have.
    fireEvent.click(nav().getByRole('button', { name: 'Control' }));
    expect(screen.getByRole('heading', { name: 'Control starts with an acquired decision.' })).toBeVisible();
    expect(nav().getByRole('button', { name: 'Control' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('preserves persisted Live Control startup and does not read a locked server session', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-LOCAL-RESUME');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Live Control recovery locked' })).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    expect(localStorage.getItem(controlSessionStorageKey)).toBe('CONTROL-LOCAL-RESUME');
    cleanup(); render(<App />);
    expect(screen.getByRole('heading', { name: 'Live Control recovery locked' })).toBeVisible();
  });

  it('retains the same theme preference across Home and Control', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'dark' } });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(nav().getByRole('button', { name: 'Control' }));
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'light' } });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('exception-broker-theme')).toBe('light');
  });

  it('exposes keyboard controls and closes the mobile menu on Escape with focus restored', () => {
    render(<HomeExperience onNavigateAcquisition={vi.fn()} onNavigateControl={vi.fn()} onNavigateControlProof={vi.fn()} onNavigateWalkthrough={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    for (const control of screen.getAllByRole('button')) expect(control).toHaveAttribute('type', 'button');
  });

  it('keeps the reduced-motion scene static without losing the HTML journey', () => {
    motionPreference.reduced = true;
    render(<HomeExperience onNavigateAcquisition={vi.fn()} onNavigateControl={vi.fn()} onNavigateControlProof={vi.fn()} onNavigateWalkthrough={vi.fn()} />);
    const image = screen.getByAltText(/Sentinel Ridge:/);
    const transform = image.style.transform;
    fireEvent(screen.getByLabelText('Sentinel Ridge decision path'), new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 100 }));
    expect(image.style.transform).toBe(transform);
    expect(image.style.transform).not.toMatch(/translate/);
    const scene = within(screen.getByLabelText('Sentinel Ridge decision path'));
    for (const title of ['Decision acquired', 'Execution gate', 'Higher ground']) expect(scene.getByText(title)).toBeVisible();
  });

  it('sends acquisition, walkthrough and proof CTA intent only, without a network request', () => {
    const acquisition = vi.fn(); const control = vi.fn(); const walkthrough = vi.fn(); const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<HomeExperience onNavigateAcquisition={acquisition} onNavigateControl={vi.fn()} onNavigateControlProof={control} onNavigateWalkthrough={walkthrough} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acquire a decision' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start acquisition' }));
    expect(acquisition).toHaveBeenCalledTimes(2);
    // Learning goes to the walkthrough; the scenario list still goes to the proof.
    fireEvent.click(screen.getByRole('button', { name: 'See it in action' }));
    fireEvent.click(screen.getByRole('button', { name: /Interactive demo/ }));
    expect(walkthrough).toHaveBeenCalledTimes(2);
    expect(control).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'View all scenarios' }));
    expect(control).toHaveBeenCalledTimes(1);
    expect(control).toHaveBeenNthCalledWith(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Home decorative and local, with reduced-motion and no duplicate state contracts', () => {
    const home = readFileSync('src/ui/HomeExperience.tsx', 'utf8');
    expect(home).not.toMatch(/fetch\(|process\.env|CALLE_API_KEY|CallEProvider|executeOrchestrationAction|prepareProof|localStorage|setTimeout/);
    expect(home).toContain('useReducedMotion');
    expect(home).toContain('reducedMotion="user"');
    const css = readFileSync('src/styles/home.css', 'utf8');
    expect(css).not.toMatch(/@import|https:\/\/|^body\s*\{|^html\s*\{/m);
    expect(css).toContain('prefers-reduced-motion:reduce');
  });
});
