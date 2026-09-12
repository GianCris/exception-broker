// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AcquisitionBrowserApi } from '../../src/acquisition/browserClient.js';
import { prepareProof, reviewProof } from '../../src/demo/proofDemo.js';
import { ProofExperience } from '../../src/ui/ProofExperience.js';
import type { LiveControlPublicRecord } from '../../src/control/contracts.js';
import { acquisitionAccessKey } from '../../src/ui/AcquisitionExperience.js';
import { LiveControlExperience } from '../../src/ui/LiveControlExperience.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

// Same surface entry the established Control regression suite uses.
const Control = () => <ProofExperience prepare={prepareProof} review={reviewProof} />;
const openReview = () => fireEvent.click(screen.getByRole('button', { name: 'Review exact proposal' }));
const sheet = () => screen.getByRole('dialog');
const focusables = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), summary')];

const liveRecord = (): LiveControlPublicRecord => ({
  controlSessionId: 'CONTROL-ACQ-LIVE-1', acquisitionId: 'ACQ-LIVE-1', definitionId: 'OPERATOR_SANDBOX', definitionVersion: 1,
  sourceBinding: { acquisitionId: 'ACQ-LIVE-1', callId: 'CALL-LIVE-1', requestId: 'REQUEST-LIVE-1', receivedAt: '2027-07-01T17:00:00-05:00', terminalAt: '2027-07-01T17:00:00-05:00', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client' },
  provenance: { acquisition: 'LIVE_CALLE', operationalContext: 'CONTROLLED_SANDBOX_CONTEXT', externalExecution: 'NONE' }, status: 'AWAITING_REVIEW',
  reviewTarget: { operationType: 'PLAN_DECISION', requestId: 'REQUEST-LIVE-1', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', decision: 'APPROVED', summary: 'Live Client approved.', proposedAuthorizationChanges: [], evidence: ['Sanitized evidence'], completionConfidence: { score: .93, label: 'high' }, receivedAt: '2027-07-01T17:00:00-05:00', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED' },
  caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', planVersion: 1, actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', createdAt: '2027-07-01T17:05:00-05:00',
});
const noopApi = () => ({ connectHosted: vi.fn(), connectByok: vi.fn(), getConnection: vi.fn(), disconnect: vi.fn(), getActive: vi.fn(), create: vi.fn(), get: vi.fn(), refresh: vi.fn(), handoff: vi.fn(), getControl: vi.fn(), review: vi.fn() } as AcquisitionBrowserApi);

describe('Exact review sheet', () => {
  it('presents the exact proposal, the fixed decision and an anchored action region', () => {
    render(<Control />);
    openReview();
    const dialog = sheet();
    expect(within(dialog).getByText('02 / Exact review')).toBeVisible();
    // The decision object keeps its mark and its value; the sheet never restates it as an outcome.
    const badge = within(dialog).getByText('APPROVED', { exact: true });
    expect(badge.closest('.proof-decision')).not.toBeNull();
    expect(within(dialog).queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
    // The reviewed numbers are in the sheet, not only behind it.
    const proposal = within(dialog).getByRole('region', { name: 'Exact proposal' });
    for (const line of ['Original units', 'Substitute units', 'Total units', 'Additional client cost', 'Client authorization', 'Target date']) {
      expect(within(proposal).getByText(line)).toBeVisible();
    }
    expect(within(proposal).getByText('350')).toBeVisible();
    expect(within(proposal).getByText('500')).toBeVisible();
    // Compact context, then the action region with its own explanation.
    expect(within(dialog).getByText('Plan version')).toBeVisible();
    expect(within(dialog).getByText('Authorization changes')).toBeVisible();
    expect(within(dialog).getByText(/Applying asks the Broker to evaluate this exact attempt\. It does not execute externally\./)).toBeVisible();
  });

  it('keeps Discard as the last focusable control so the focus trap still wraps', () => {
    render(<Control />);
    openReview();
    const dialog = sheet();
    const order = focusables(dialog).map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim());
    expect(order[0]).toBe('Close exact review');
    expect(order.at(-1)).toBe('Discard');
    expect(order).toContain('Apply reviewed decision');
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close exact review' }), { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toHaveFocus();
  });

  it('keeps deep binding collapsed until the reviewer asks for it', () => {
    render(<Control />);
    openReview();
    const dialog = sheet();
    const binding = within(dialog).getByText('Inspect exact binding').closest('details')!;
    expect(binding).not.toHaveAttribute('open');
    fireEvent.click(within(dialog).getByText('Inspect exact binding'));
    expect(binding).toHaveAttribute('open');
    expect(within(binding).getByText('Case')).toBeInTheDocument();
    expect(within(binding).getByText('Request')).toBeInTheDocument();
    expect(binding.querySelector('pre')).not.toBeNull();
  });

  it('never opens with a fully transparent scrim, so the sheet is readable on first paint', () => {
    render(<Control />);
    openReview();
    const backdrop = sheet().closest('.review-backdrop') as HTMLElement;
    expect(Number(backdrop.style.opacity || '1')).toBeGreaterThan(0);
    expect(sheet()).toBeVisible();
  });

  it('gives Live Control the same sheet structure and its own truthful source', () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<LiveControlExperience api={noopApi()} initial={liveRecord()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review exact decision' }));
    const dialog = sheet();
    expect(within(dialog).getByText('02 / Exact review · live decision')).toBeVisible();
    expect(within(dialog).getByRole('region', { name: 'Exact decision' })).toBeVisible();
    expect(within(dialog).getByText(/CALL-E live acquisition/)).toBeVisible();
    expect(within(dialog).getByText(/does not execute anything outside this controlled local context/)).toBeVisible();
    expect(focusables(dialog).at(-1)?.textContent?.trim()).toBe('Discard');
    expect(within(dialog).getByRole('button', { name: 'Close exact review' })).toBeVisible();
  });

  it('styles the sheet as a deliberate side sheet rather than a full-width admin modal', () => {
    const control = readFileSync('src/styles/control.css', 'utf8');
    // 430-500px keeps the instrument behind it legible while reviewing.
    expect(control).toMatch(/\.review-sheet \{[^}]*width: min\(468px, 100%\)/);
    expect(control).toMatch(/\.sheet-body \{[^}]*overflow-y: auto/);
    expect(control).toMatch(/\.sheet-actions \{[^}]*flex: none/);
    // A calm scrim, not a generic blackout, in both finishes.
    expect(control).toMatch(/:root\[data-theme="light"\] \.control-surface \.review-backdrop/);
  });
});
