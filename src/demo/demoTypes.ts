import type { Approval, ExceptionCase, Plan } from '../domain/types.js';
import type { ProcessedOperation } from '../domain/operationHistory.js';
import type { ThreePartyFlowConfig, ThreePartyFlowState } from '../integrations/calle/threePartyFlow.js';

export type DemoMode = 'LOCAL_SIMULATION';
export type KnownUnavailableDemoMode = 'LIVE_CALL_E' | 'RECORDED_RUN';

export type DemoRunnerInput = Readonly<{
  mode: unknown;
  scenario: ThreePartyFlowConfig;
  runId: unknown;
  startedAt: unknown;
  completedAt: unknown;
}>;

export type DemoStepType =
  | 'PLAN-001_REJECTED'
  | 'PLAN-002_NO_SOLUTION'
  | 'CASE_AUTHORIZATION_APPLIED'
  | 'PLAN-003_CREATED'
  | 'SUPPLIER_APPROVED'
  | 'PRODUCTION_APPROVED'
  | 'CLIENT_APPROVED'
  | 'PLAN-003_FINALIZED'
  | 'CASE_RESOLVED';

export type DemoStep = Readonly<{
  type: DemoStepType;
  status: 'COMPLETED';
  caseId: string;
  message: string;
  planId?: string;
  actorId?: string;
  requestId?: string;
  operationId?: string;
  approvalId?: string;
}>;

export type DemoCompletedResult = Readonly<{
  status: 'COMPLETED';
  mode: DemoMode;
  runId: string;
  startedAt: string;
  completedAt: string;
  finalCase: ExceptionCase;
  finalPlans: readonly Plan[];
  approvals: readonly Approval[];
  operationHistory: readonly ProcessedOperation[];
  steps: readonly DemoStep[];
  summary: 'CASE_RESOLVED';
}>;

export type DemoFailedResult = Readonly<{
  status: 'FAILED';
  mode: DemoMode;
  runId: string;
  startedAt: string;
  completedAt: string;
  failedStep: string;
  reason: string;
  partialState: ThreePartyFlowState;
  steps: readonly DemoStep[];
  summary: 'CASE_NOT_RESOLVED';
}>;

export type DemoBlockedResult = Readonly<{
  status: 'BLOCKED';
  mode: string;
  runId?: string;
  reason: 'MODE_NOT_AVAILABLE' | 'INVALID_MODE' | 'INVALID_CONFIGURATION';
  issues?: readonly string[];
}>;

export type DemoRunResult = DemoCompletedResult | DemoFailedResult | DemoBlockedResult;
