import { approvalsForPlan } from '../domain/approvals.js';
import type { Case001SimulationResult } from '../domain/simulation.js';
import type { ActorRole, PlanStatus } from '../domain/types.js';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Lima',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Lima',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Lima',
  hour: 'numeric',
  minute: '2-digit',
});

export const formatDate = (value: string): string =>
  dateFormatter.format(new Date(value));

export const formatDateTime = (value: string): string =>
  dateTimeFormatter.format(new Date(value));

export const formatTime = (value: string): string =>
  timeFormatter.format(new Date(value));

export const formatCost = (value: number): string =>
  `S/${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const formatLabel = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const authorizationFieldLabels = {
  maxSubstituteQuantity: 'Maximum substitute units',
} as const;

export type PlanViewModel = Readonly<{
  id: string;
  version: number;
  status: PlanStatus;
  statusLabel: string;
  tomorrowTotal: number;
  originalTomorrow: number;
  substituteTomorrow: number;
  originalLater: number;
  laterDeliveryDate: string;
  clientAdditionalCost: string;
}>;

export const createCase001ViewModel = (simulation: Case001SimulationResult) => {
  const plans: readonly PlanViewModel[] = [...simulation.plans]
    .sort((left, right) => left.version - right.version)
    .map((plan) => ({
      id: plan.id,
      version: plan.version,
      status: plan.status,
      statusLabel: formatLabel(plan.status),
      tomorrowTotal:
        plan.originalQuantityTomorrow + plan.substituteQuantityTomorrow,
      originalTomorrow: plan.originalQuantityTomorrow,
      substituteTomorrow: plan.substituteQuantityTomorrow,
      originalLater: plan.originalQuantityLater,
      laterDeliveryDate: formatDateTime(plan.laterDeliveryDate),
      clientAdditionalCost: formatCost(plan.clientAdditionalCost),
    }));
  const finalPlan = simulation.plans.find(
    ({ id }) => id === simulation.finalPlanId,
  );
  const finalValidation = simulation.validations.find(
    ({ planId }) => planId === simulation.finalPlanId,
  );
  const finalApprovals =
    simulation.finalPlanId === null
      ? []
      : approvalsForPlan(simulation.approvals, simulation.finalPlanId).map(
          (approval) => ({
            actorId: approval.actorId,
            role: approval.actorRole,
            roleLabel: formatLabel(approval.actorRole),
            decision: approval.decision,
            decisionLabel: formatLabel(approval.decision),
            createdAt: formatDateTime(approval.createdAt),
          }),
        );

  return {
    header: {
      caseId: simulation.caseId,
      requestedQuantity: simulation.updatedCase.requestedQuantity,
      targetDeliveryDate: formatDateTime(
        simulation.updatedCase.targetDeliveryDate,
      ),
      status: simulation.status,
      statusLabel: formatLabel(simulation.status),
    },
    plans,
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
    finalPlan:
      finalPlan === undefined
        ? null
        : {
            id: finalPlan.id,
            originalTomorrow: finalPlan.originalQuantityTomorrow,
            substituteTomorrow: finalPlan.substituteQuantityTomorrow,
            originalLater: finalPlan.originalQuantityLater,
            laterDeliveryDate: formatDateTime(finalPlan.laterDeliveryDate),
            clientAdditionalCost: formatCost(finalPlan.clientAdditionalCost),
            costAllocation: [
              {
                role: 'supplier' as ActorRole,
                label: formatLabel('supplier'),
                cost: formatCost(finalPlan.supplierAbsorbedCost),
              },
              {
                role: 'production' as ActorRole,
                label: formatLabel('production'),
                cost: formatCost(finalPlan.productionAbsorbedCost),
              },
              {
                role: 'client' as ActorRole,
                label: formatLabel('client'),
                cost: formatCost(finalPlan.clientAdditionalCost),
              },
            ],
            validationPassed: finalValidation?.result.valid === true,
          },
    approvals: finalApprovals,
    events: [...simulation.events]
      .sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      )
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
