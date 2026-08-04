import { approvalsForPlan } from '../domain/approvals.js';
import type { Case001SimulationResult } from '../domain/simulation.js';
import type { ActorRole, PlanId, PlanStatus } from '../domain/types.js';

const presentationTimeZone = 'America/Lima';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: presentationTimeZone,
  month: 'short', day: 'numeric', year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: presentationTimeZone,
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: presentationTimeZone,
  hour: 'numeric', minute: '2-digit',
});

export const formatDate = (value: string): string => dateFormatter.format(new Date(value));
export const formatDateTime = (value: string): string => dateTimeFormatter.format(new Date(value));
export const formatTime = (value: string): string => timeFormatter.format(new Date(value));
export const formatCost = (value: number): string =>
  `S/${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatLabel = (value: string): string =>
  value.toLowerCase().split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

const authorizationFieldLabels = { maxSubstituteQuantity: 'Client substitute limit' } as const;

type PlanExplanation =
  | Readonly<{ kind: 'rejected'; proposedSubstitutes: number; clientLimit: number; reason: string }>
  | Readonly<{ kind: 'no-solution'; requiredTomorrow: number; availableTomorrow: number; shortfall: number }>
  | Readonly<{ kind: 'final'; unlockPreviousValue: number; unlockNewValue: number }>;

export type PlanViewModel = Readonly<{
  id: PlanId;
  version: number;
  status: PlanStatus;
  statusLabel: string;
  isFinal: boolean;
  tomorrowTotal: number;
  originalTomorrow: number;
  substituteTomorrow: number;
  originalLater: number;
  laterDeliveryDate: string;
  clientAdditionalCost: string;
  costAllocation: readonly Readonly<{ role: ActorRole; label: string; cost: string }>[];
  validationPassed: boolean;
  explanation: PlanExplanation;
}>;

export const createCase001ViewModel = (simulation: Case001SimulationResult) => {
  const authorizationChange = simulation.authorizationChanges.find(
    ({ field }) => field === 'maxSubstituteQuantity',
  );
  const finalValidation = simulation.validations.find(({ planId }) => planId === simulation.finalPlanId);
  const plans: readonly PlanViewModel[] = [...simulation.plans]
    .sort((left, right) => left.version - right.version)
    .map((plan) => {
      const isFinal = plan.id === simulation.finalPlanId;
      const validation = simulation.validations.find(({ planId }) => planId === plan.id);
      let explanation: PlanExplanation;

      if (isFinal && authorizationChange !== undefined) {
        explanation = {
          kind: 'final',
          unlockPreviousValue: authorizationChange.previousValue,
          unlockNewValue: authorizationChange.newValue,
        };
      } else if (plan.status === 'NO_SOLUTION') {
        explanation = {
          kind: 'no-solution',
          requiredTomorrow: simulation.noSolutionEvidence.requiredMinimumUnitsTomorrow,
          availableTomorrow: simulation.noSolutionEvidence.availableUnitsTomorrow,
          shortfall:
            simulation.noSolutionEvidence.requiredMinimumUnitsTomorrow -
            simulation.noSolutionEvidence.availableUnitsTomorrow,
        };
      } else {
        const r04 = validation?.result.violations.find(({ ruleId }) => ruleId === 'R-04');
        explanation = {
          kind: 'rejected',
          proposedSubstitutes: plan.substituteQuantityTomorrow,
          clientLimit: authorizationChange?.previousValue ?? 0,
          reason: r04?.message ?? '',
        };
      }

      return {
        id: plan.id,
        version: plan.version,
        status: plan.status,
        statusLabel: formatLabel(plan.status),
        isFinal,
        tomorrowTotal: plan.originalQuantityTomorrow + plan.substituteQuantityTomorrow,
        originalTomorrow: plan.originalQuantityTomorrow,
        substituteTomorrow: plan.substituteQuantityTomorrow,
        originalLater: plan.originalQuantityLater,
        laterDeliveryDate: formatDateTime(plan.laterDeliveryDate),
        clientAdditionalCost: formatCost(plan.clientAdditionalCost),
        costAllocation: [
          { role: 'supplier', label: formatLabel('supplier'), cost: formatCost(plan.supplierAbsorbedCost) },
          { role: 'production', label: formatLabel('production'), cost: formatCost(plan.productionAbsorbedCost) },
          { role: 'client', label: formatLabel('client'), cost: formatCost(plan.clientAdditionalCost) },
        ],
        validationPassed: isFinal && finalValidation?.result.valid === true,
        explanation,
      };
    });
  const finalPlan = plans.find(({ id }) => id === simulation.finalPlanId) ?? null;
  const resolutionAvailable = finalPlan !== null;
  const priorPlans = resolutionAvailable
    ? plans.filter(({ version }) => version < finalPlan.version)
    : plans;

  return {
    header: {
      caseId: simulation.caseId,
      caseLabel: `${simulation.caseId} · Supply exception`,
      title: `${simulation.updatedCase.requestedQuantity}-unit shortage resolved`,
      requestedQuantity: simulation.updatedCase.requestedQuantity,
      participantCount: simulation.updatedCase.actors.length,
      targetDeliveryDate: formatDateTime(simulation.updatedCase.targetDeliveryDate),
      status: simulation.status,
      statusLabel: formatLabel(simulation.status),
    },
    priorPlans,
    finalPlan,
    resolutionAvailable,
    authorizationChanges: simulation.authorizationChanges.map((change) => ({
      actorRole: change.actorRole,
      actorLabel: formatLabel(change.actorRole),
      field: change.field,
      fieldLabel: authorizationFieldLabels[change.field],
      previousValue: change.previousValue,
      newValue: change.newValue,
      reason: change.reason,
      createdAt: formatDateTime(change.createdAt),
    })),
    finalApprovals:
      finalPlan === null
        ? []
        : approvalsForPlan(simulation.approvals, finalPlan.id).map((approval) => ({
            actorId: approval.actorId,
            planId: approval.planId,
            role: approval.actorRole,
            roleLabel: formatLabel(approval.actorRole),
            decision: approval.decision,
            decisionLabel: formatLabel(approval.decision),
            createdAt: formatDateTime(approval.createdAt),
          })),
    events: [...simulation.events]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((event) => ({
        id: event.eventId,
        date: formatDate(event.createdAt),
        time: formatTime(event.createdAt),
        type: event.type,
        typeLabel: formatLabel(event.type),
        planId: event.planId,
        actorId: event.actorId,
        message: event.message,
      })),
  } as const;
};
