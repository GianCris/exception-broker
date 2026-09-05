// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { App } from '../../src/App.js';
import { ProofExperience } from '../../src/ui/ProofExperience.js';
import { prepareProof, reviewProof } from '../../src/demo/proofDemo.js';
import { createReadyDecisionBridgeResult } from '../../src/integrations/calle/decisionBridge.js';

afterEach(cleanup);
const openReview = () => fireEvent.click(screen.getByRole('button', { name: 'Review exact proposal' }));
const apply = () => { openReview(); fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed decision' })); };
const select = (id: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${id} /`) }));
const revealSupporting = () => fireEvent.click(screen.getByText('Supporting proof details'));

describe('Evidence-to-decision primary experience', () => {
  it('starts on H02 with factual evidence and a genuine review pause, not a spoiled result', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /^H02 \// })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Supporting proof details')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your explicit review is required' })).not.toBeVisible();
    expect(screen.getByText('350 original + 100 substitute units')).toBeInTheDocument();
    expect(screen.queryByText('PLAN_PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.queryByText('PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-attempt snapshot assessments' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review exact proposal' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Apply reviewed decision' })).not.toBeInTheDocument();
  });

  it('H02 click exposes the real physical reason and operation-scoped zero effects', () => {
    render(<App />); apply();
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Physical supply cannot support this approval' })).toBeInTheDocument();
    expect(screen.getAllByText('PLAN_PHYSICALLY_INFEASIBLE').length).toBeGreaterThan(0);
    expect(screen.getByText('SUBSTITUTE_SUPPLY_EXCEEDED: 150 required / 100 available')).toBeInTheDocument();
    expect(screen.getByText('PLAN_VALID')).toBeInTheDocument();
    expect(screen.getByText(/same state reference/)).toBeInTheDocument();
    const effects = screen.getByRole('heading', { name: 'Effects of this attempt only' }).parentElement!;
    expect(within(effects).getAllByText('0')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Review exact proposal' })).not.toBeInTheDocument();
    expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
  });

  it('H01 requires fresh visible role reviews and shows only local authorization', () => {
    render(<App />); select('H01');
    for (const role of ['client', 'production', 'supplier']) {
      openReview();
      expect(screen.getByRole('heading', { name: `Review the ${role} decision` })).toBeInTheDocument();
      expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed decision' }));
    }
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Recovery authorized locally' })).toBeInTheDocument();
    expect(screen.getAllByText('ALLOW', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Before this attempt: 2 decision records, 2 operations, 2 events/)).toBeInTheDocument();
    expect(screen.getByText(/No shipment, ERP\/WMS write, or external execution/)).toBeInTheDocument();
    const outcome = screen.getByRole('region', { name: 'Recovery authorized locally' });
    const basis = within(outcome).getByRole('region', { name: 'Why this result is supportable' });
    expect(within(basis).getByText('Formal snapshot: PLAN_VALID.')).toBeInTheDocument();
    expect(within(basis).getByText(/SUBSTITUTE: 150 required \/ 150 available/)).toBeInTheDocument();
    expect(within(basis).getByText(/version 1, current in its lineage at the attempted snapshot/)).toBeInTheDocument();
    expect(within(basis).getByText(/Local result: APPROVED · LINEAGE_RESOLVED/)).toBeInTheDocument();
    expect(within(basis).getByText(/not a sequential gate-execution trace/)).toBeInTheDocument();
    expect(basis.closest('details')).toHaveClass('supporting-proof');
    expect(basis.textContent).not.toMatch(/all gates passed/i);
    expect(within(outcome).getByText('New decision breakdown: 1 APPROVED / 0 REJECTED.')).toBeInTheDocument();
  });

  it('scenario switching and reset cannot carry a reviewed proposal or effects', () => {
    render(<App />); apply(); select('H01');
    expect(screen.queryByRole('heading', { name: 'Effects of this attempt only' })).not.toBeInTheDocument();
    expect(screen.queryByText('PLAN_PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.getByText(/CASE-PROOF-H01 \/ PLAN-PROOF-H01/)).toBeInTheDocument();
    apply();
    fireEvent.click(screen.getByRole('button', { name: 'Reset this scenario' }));
    openReview();
    expect(screen.getByRole('heading', { name: 'Review the client decision' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Effects of this attempt only' })).not.toBeInTheDocument();
    select('H02');
    expect(screen.getByText('350 original + 100 substitute units')).toBeInTheDocument();
  });

  it('H03 shows unaccepted claims and never offers review or fabricated feasibility', () => {
    render(<App />); select('H03');
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Input claims — not a trusted snapshot' })).toBeInTheDocument();
    expect(screen.getAllByText('Unaccepted input claim')).toHaveLength(4);
    expect(screen.queryByText('Accepted evidence')).not.toBeInTheDocument();
    expect(screen.getByText(/No trusted case produced/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply reviewed decision' })).not.toBeInTheDocument();
    expect(screen.queryByText('PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-attempt snapshot assessments' })).not.toBeInTheDocument();
  });

  it('DISCARD is a real result and cannot subsequently apply the same review', () => {
    render(<App />);
    openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Proposal discarded by reviewer' })).toBeInTheDocument();
    expect(screen.getAllByText('DISCARDED_BY_REVIEWER').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Apply reviewed decision' })).not.toBeInTheDocument();
  });

  it('separates historical operator-reported live acquisition from deterministic application', () => {
    render(<App />);
    revealSupporting();
    const historical = screen.getByRole('complementary', { name: 'Real CALL-E acquisition. Separate from this browser session.' });
    expect(within(historical).getByText(/did not produce the selected deterministic scenario/)).toBeInTheDocument();
    expect(within(historical).getByText(/NOT DEMONSTRATED/)).toBeInTheDocument();
    expect(within(historical).getByText(/No original recording is bundled/)).toBeInTheDocument();
    expect(within(historical).getByText(/OPERATOR-LIVE-V1/)).toBeInTheDocument();
    expect(within(historical).getByText(/OPERATOR-LIVE-V2/)).toBeInTheDocument();
    expect(within(historical).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Configured ERP \/ WMS sources are not live connections/)).toBeInTheDocument();
    expect(screen.getByText(/authenticated reviewer identity.*NOT DEMONSTRATED/)).toBeInTheDocument();
    openReview();
    expect(screen.getByText(/not a live CALL-E response/)).toBeInTheDocument();
  });

  it('keeps browser entry and new demo/presentation composition free of network and clock mechanisms', () => {
    const sources = ['src/App.tsx', 'src/ui/ProofExperience.tsx', 'src/demo/proofDemo.ts', 'src/presentation/decisionTraceViewModel.ts']
      .map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(sources).not.toMatch(/fetch\s*\(|axios|process\.env|CALLE_API_KEY|new CallEProvider|Date\.now|new Date\(|Math\.random|randomUUID/);
    expect(sources).not.toMatch(/from ['"][^'"]*(?:callEProvider|mockProvider|\/adapter)\.js/);
    expect(sources).not.toContain('12/12');
  });

  it('renders an unknown technical failure as WAIT, not a successful or business-safety result', () => {
    const prepared = prepareProof('H02');
    const failed = { ...prepared, stopped: true, registration: { accepted: false as const, state: prepared.state!, failure: { source: 'STATE' as const, reason: 'UNKNOWN_PREPARATION_FAILURE' } } };
    render(<ProofExperience prepare={() => failed} review={reviewProof} />);
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Preparation stopped — inspect the technical result' })).toBeInTheDocument();
    expect(screen.getByText('UNKNOWN_PREPARATION_FAILURE')).toBeInTheDocument();
    expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/Only local plan registration has occurred/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-attempt snapshot assessments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review exact proposal' })).not.toBeInTheDocument();
  });

  it('the complete local App import graph excludes live acquisition entry points', () => {
    const visited = new Set<string>();
    const inspect = (path: string) => {
      if (visited.has(path)) return;
      visited.add(path);
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/@call-e\/calle|process\.env|fetch\s*\(|XMLHttpRequest|WebSocket/);
      for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const base = resolve(dirname(path), match[1]!).replace(/\.js$/, '');
        const file = [`${base}.ts`, `${base}.tsx`].find(existsSync);
        if (file) inspect(file);
      }
    };
    inspect(resolve('src/App.tsx'));
    expect([...visited].some((path) => /callEProvider\.ts|mockProvider\.ts|[/\\]adapter\.ts$/.test(path))).toBe(false);
    expect([...visited].some((path) => path.endsWith('adaptiveOrchestrator.ts'))).toBe(true);
    expect([...visited].some((path) => path.endsWith('decisionApplication.ts'))).toBe(true);
  });

  it('renders a real rejection as a new rejected decision record, never as a new approval', () => {
    const session = prepareProof('H01');
    if (!session.bridge?.ready) throw new Error('Bridge required');
    const rejected = reviewProof({ ...session, bridge: createReadyDecisionBridgeResult({ ...session.bridge.proposal, decision: 'REJECTED' }) }, 'APPLY');
    render(<ProofExperience prepare={() => rejected} review={reviewProof} />);
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Decision recorded as REJECTED — recovery not authorized' })).toBeInTheDocument();
    expect(screen.getByText('PLAN_REJECTED', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('New decision breakdown: 0 APPROVED / 1 REJECTED.')).toBeInTheDocument();
    expect(screen.queryByText('New approvals')).not.toBeInTheDocument();
    expect(screen.getByText('New decision records')).toBeInTheDocument();
  });

  it('renders a three-item control queue from current deterministic snapshots without equating APPROVED to ALLOW', () => {
    render(<App />);
    const queue = screen.getByRole('complementary', { name: 'Needs attention' });
    expect(within(queue).getAllByRole('button')).toHaveLength(3);
    expect(within(queue).getAllByText('APPROVED')).toHaveLength(2);
    expect(within(queue).getAllByText('NOT RESOLVED')).toHaveLength(2);
    expect(within(queue).queryByText('ALLOW')).not.toBeInTheDocument();
    expect(within(queue).getByText('WAIT')).toBeInTheDocument();
  });

  it('keeps authority scope distinct from exact review completion in the side sheet', () => {
    render(<App />);
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(within(model).getByText('EXACT REVIEW REQUIRED')).toBeInTheDocument();
    expect(within(model).getByText('NOT RESOLVED')).toBeInTheDocument();
    openReview();
    const sheet = screen.getByRole('dialog', { name: 'Review the client decision' });
    expect(within(sheet).getByText(/Review applies to this exact proposal/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Synthetic decision input, not a live CALL-E response/)).toBeInTheDocument();
  });

  it('keeps supporting proof depth collapsed until deliberately revealed while primary control remains visible', () => {
    render(<App />);
    const disclosure = screen.getByText('Supporting proof details').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(within(model).getByText('APPROVED')).toBeVisible();
    expect(within(model).getByText('EXACT REVIEW REQUIRED')).toBeVisible();
    expect(within(model).getByText('Not evaluated for application')).toBeVisible();
    expect(within(model).getByText('NOT RESOLVED')).toBeVisible();
    expect(within(model).getByText(/normalized decision is ready/)).toBeVisible();
    expect(screen.getAllByText(/Deterministic local proof · configured evidence/).some((element) => element.closest('.control-next'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Review exact proposal' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Trusted snapshot facts' })).not.toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your explicit review is required' })).not.toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Real CALL-E acquisition. Separate from this browser session.' })).not.toBeVisible();
    revealSupporting();
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Trusted snapshot facts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your explicit review is required' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Real CALL-E acquisition. Separate from this browser session.' })).toBeInTheDocument();
  });
});
