import { hasAllRequiredApprovals } from '../domain/approvals.js';
import {
  createSuccessorPlan,
  validatePlanDecisionFreshness,
  type PlanLineage,
  type PlanLineageId,
} from '../domain/planLineage.js';
import {
  registerInitialPlanProposal,
  type PlanRegistrationAssessment,
} from '../domain/planRegistration.js';
import type { ProcessedOperation } from '../domain/operationHistory.js';
import type { PlanConditionChanges } from '../domain/versioning.js';
import type { Approval, CaseId, ExceptionCase, Plan, PlanId } from '../domain/types.js';
import {
  applyReviewedDecision,
  type DecisionApplicationEvent,
  type ReviewCommand,
} from '../integrations/calle/decisionApplication.js';
import type { DecisionBridgeResult } from '../integrations/calle/decisionBridge.js';

export type OrchestrationState = Readonly<{
  exceptionCase: ExceptionCase;
  plans: readonly Plan[];
  planLineages: readonly PlanLineage[];
  approvals: readonly Approval[];
  operationHistory: readonly ProcessedOperation[];
  events: readonly DecisionApplicationEvent[];
}>;

export type OrchestrationAction =
  | Readonly<{
      type: 'REGISTER_PLAN_PROPOSAL';
      lineageId: PlanLineageId;
      plan: unknown;
    }>
  | Readonly<{
      type: 'CREATE_SUCCESSOR';
      lineageId: PlanLineageId;
      predecessorPlanId: PlanId;
      newPlanId: PlanId;
      changes: PlanConditionChanges;
    }>
  | Readonly<{
      type: 'APPLY_REVIEWED_DECISION';
      bridgeResult: DecisionBridgeResult;
      review: ReviewCommand;
    }>;

export type OrchestrationDisposition =
  | Readonly<{ type: 'AWAITING_EXTERNAL_ACTION' }>
  | Readonly<{
      type: 'LINEAGE_RESOLVED';
      scope: Readonly<{ caseId: CaseId; lineageId: PlanLineageId; planId: PlanId }>;
    }>;

export type OrchestrationStep =
  | Readonly<{
      actionType: 'REGISTER_PLAN_PROPOSAL';
      result: 'PLAN_PROPOSAL_REGISTERED';
      affectedPlanId: PlanId;
      lineageId: PlanLineageId;
      assessment: PlanRegistrationAssessment;
    }>
  | Readonly<{
      actionType: 'CREATE_SUCCESSOR';
      result: 'SUCCESSOR_CREATED';
      affectedPlanId: PlanId;
      lineageId: PlanLineageId;
    }>
  | Readonly<{
      actionType: 'APPLY_REVIEWED_DECISION';
      result: 'DECISION_APPLIED';
      affectedPlanId?: PlanId;
      applicationEventIds: readonly string[];
      applicationResolutionStatus:
        | 'PENDING_APPROVALS'
        | 'PLAN_APPROVED'
        | 'PLAN_REJECTED'
        | 'CASE_AUTHORIZATION_APPLIED';
    }>;

export type OrchestrationFailureSource =
  | 'STATE'
  | 'PLAN_REGISTRATION'
  | 'PLAN_LINEAGE'
  | 'DECISION_APPLICATION';

export type OrchestrationResult =
  | Readonly<{
      accepted: true;
      state: OrchestrationState;
      disposition: OrchestrationDisposition;
      step: OrchestrationStep;
    }>
  | Readonly<{
      accepted: false;
      state: OrchestrationState;
      failure: Readonly<{
        source: OrchestrationFailureSource;
        reason: string;
        issues?: readonly string[];
      }>;
    }>;

const failure = (
  state: OrchestrationState,
  source: OrchestrationFailureSource,
  reason: string,
  issues?: readonly string[],
): OrchestrationResult => ({
  accepted: false,
  state,
  failure: { source, reason, ...(issues === undefined ? {} : { issues }) },
});

const waiting: OrchestrationDisposition = { type: 'AWAITING_EXTERNAL_ACTION' };

export const executeOrchestrationAction = (
  state: OrchestrationState,
  action: OrchestrationAction,
): OrchestrationResult => {
  if (typeof action !== 'object' || action === null || typeof (action as { type?: unknown }).type !== 'string') {
    return failure(state, 'STATE', 'ACTION_NOT_ADMISSIBLE');
  }

  switch (action.type) {
    case 'REGISTER_PLAN_PROPOSAL': {
      const registered = registerInitialPlanProposal(
        state.exceptionCase,
        state.planLineages,
        state.plans,
        action.lineageId,
        action.plan,
      );
      if (!registered.success) {
        return failure(state, 'PLAN_REGISTRATION', registered.reason, registered.issues);
      }

      return {
        accepted: true,
        state: {
          ...state,
          plans: registered.plans,
          planLineages: registered.lineages,
        },
        disposition: waiting,
        step: {
          actionType: action.type,
          result: 'PLAN_PROPOSAL_REGISTERED',
          affectedPlanId: registered.plan.id,
          lineageId: registered.lineage.lineageId,
          assessment: registered.assessment,
        },
      };
    }

    case 'CREATE_SUCCESSOR': {
      const created = createSuccessorPlan(
        action.lineageId,
        state.planLineages,
        state.plans,
        action.predecessorPlanId,
        action.newPlanId,
        action.changes,
      );
      if (!created.success) return failure(state, 'PLAN_LINEAGE', created.reason, created.issues);

      return {
        accepted: true,
        state: {
          ...state,
          plans: created.plans,
          planLineages: created.lineages,
        },
        disposition: waiting,
        step: {
          actionType: action.type,
          result: 'SUCCESSOR_CREATED',
          affectedPlanId: created.plan.id,
          lineageId: created.lineage.lineageId,
        },
      };
    }

    case 'APPLY_REVIEWED_DECISION': {
      if (
        typeof action.bridgeResult !== 'object'
        || action.bridgeResult === null
        || typeof action.review !== 'object'
        || action.review === null
      ) {
        return failure(state, 'STATE', 'ACTION_NOT_ADMISSIBLE');
      }
      const applied = applyReviewedDecision(action.bridgeResult, {
        exceptionCase: state.exceptionCase,
        plans: state.plans,
        planLineages: state.planLineages,
        approvals: state.approvals,
        operationHistory: state.operationHistory,
        existingEventIds: state.events.map(({ eventId }) => eventId),
      }, action.review);
      if (!applied.applied) {
        return failure(state, 'DECISION_APPLICATION', applied.reason, applied.issues);
      }

      const nextState: OrchestrationState = {
        exceptionCase: applied.value.updatedCase,
        plans: applied.value.updatedPlans,
        planLineages: state.planLineages,
        approvals: applied.value.approvals,
        operationHistory: applied.value.updatedOperationHistory,
        events: [...state.events, ...applied.value.proposedEvents],
      };
      const proposal = action.bridgeResult.ready ? action.bridgeResult.proposal : undefined;
      const affectedPlan = proposal?.operationType === 'PLAN_DECISION'
        ? nextState.plans.find(({ id }) => id === proposal.planId)
        : undefined;
      const step: OrchestrationStep = {
        actionType: action.type,
        result: 'DECISION_APPLIED',
        ...(affectedPlan === undefined ? {} : { affectedPlanId: affectedPlan.id }),
        applicationEventIds: applied.value.proposedEvents.map(({ eventId }) => eventId),
        applicationResolutionStatus: applied.value.resolutionStatus,
      };

      if (applied.value.resolutionStatus !== 'PLAN_APPROVED') {
        return { accepted: true, state: nextState, disposition: waiting, step };
      }
      if (proposal?.operationType !== 'PLAN_DECISION' || affectedPlan === undefined) {
        return failure(state, 'STATE', 'RESOLUTION_STATE_AMBIGUOUS');
      }

      const freshness = validatePlanDecisionFreshness(
        nextState.planLineages,
        nextState.plans,
        nextState.exceptionCase.id,
        affectedPlan.id,
      );
      const approvalEvent = applied.value.proposedEvents.some(
        (event) => event.result === 'PLAN_APPROVED' && event.planId === affectedPlan.id,
      );
      if (
        !freshness.valid
        || freshness.plan.status !== 'APPROVED'
        || !hasAllRequiredApprovals(nextState.exceptionCase, freshness.plan, nextState.approvals)
        || !approvalEvent
      ) {
        return failure(
          state,
          'STATE',
          'RESOLUTION_STATE_AMBIGUOUS',
          freshness.valid ? undefined : [freshness.reason, ...(freshness.issues ?? [])],
        );
      }

      return {
        accepted: true,
        state: nextState,
        disposition: {
          type: 'LINEAGE_RESOLVED',
          scope: {
            caseId: nextState.exceptionCase.id,
            lineageId: freshness.lineage.lineageId,
            planId: freshness.plan.id,
          },
        },
        step,
      };
    }

    default:
      return failure(state, 'STATE', 'ACTION_TYPE_UNSUPPORTED');
  }
};
