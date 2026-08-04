import { approvalsForPlan, hasAllRequiredApprovals } from '../domain/approvals.js';
import type { Case001SimulationResult } from '../domain/simulation.js';
import type { ActorRole, PlanId, PlanStatus } from '../domain/types.js';

const presentationTimeZone = 'America/Lima';
const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: presentationTimeZone, month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: presentationTimeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: presentationTimeZone, hour: 'numeric', minute: '2-digit' });

export const formatDate = (value: string): string => dateFormatter.format(new Date(value));
export const formatDateTime = (value: string): string => dateTimeFormatter.format(new Date(value));
export const formatTime = (value: string): string => timeFormatter.format(new Date(value));
export const formatCost = (value: number): string => `S/${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatLabel = (value: string): string => value.toLowerCase().split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

type PresentationTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';
const planStatusPresentation: Record<PlanStatus, Readonly<{ label: string; tone: PresentationTone }>> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  NO_SOLUTION: { label: 'No solution', tone: 'warning' },
  INVALIDATED: { label: 'Invalidated', tone: 'neutral' },
  APPROVED: { label: 'Approved', tone: 'success' },
};

const presentPlanStatus = (status: string): Readonly<{ label: string; tone: PresentationTone }> =>
  Object.prototype.hasOwnProperty.call(planStatusPresentation, status)
    ? planStatusPresentation[status as PlanStatus]
    : { label: 'Unavailable', tone: 'neutral' };

const authorizationFieldLabels = { maxSubstituteQuantity: 'Client substitute limit' } as const;

type PlanExplanation =
  | Readonly<{ kind: 'rejected'; proposedSubstitutes: number; clientLimit: number; reason: string }>
  | Readonly<{ kind: 'no-solution'; requiredTomorrow: number; availableTomorrow: number; shortfall: number }>
  | Readonly<{ kind: 'final'; unlockPreviousValue: number; unlockNewValue: number }>
  | Readonly<{ kind: 'neutral'; message: string }>;

export type PlanViewModel = Readonly<{
  id: PlanId;
  version: number;
  status: string;
  statusLabel: string;
  statusTone: PresentationTone;
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
  const orderedPlans = [...simulation.plans].sort((left, right) => left.version - right.version);
  const finalPlanSource = simulation.finalPlanId === null
    ? undefined
    : orderedPlans.find(({ id }) => id === simulation.finalPlanId);
  const finalValidation = finalPlanSource === undefined
    ? undefined
    : simulation.validations.find(({ planId }) => planId === finalPlanSource.id);
  const approvalsValid = finalPlanSource !== undefined && hasAllRequiredApprovals(
    simulation.updatedCase,
    finalPlanSource,
    simulation.approvals,
  );
  const finalPlanApprovalRecords = finalPlanSource === undefined
    ? []
    : approvalsForPlan(simulation.approvals, finalPlanSource.id);
  // The domain validates current decisions but does not expose the selected
  // records. Presentation therefore fails closed when history is not an
  // unambiguous three-record approval set.
  const approvalEvidencePresentable =
    approvalsValid &&
    finalPlanApprovalRecords.length === simulation.updatedCase.actors.length &&
    finalPlanApprovalRecords.every(({ decision }) => decision === 'APPROVED');
  const resolutionAvailable = finalPlanSource !== undefined;
  const resolutionApproved =
    finalPlanSource?.status === 'APPROVED' && approvalEvidencePresentable;
  const authorizationChange = simulation.authorizationChanges.find(
    ({ field }) => field === 'maxSubstituteQuantity',
  );
  const authorizationChangeAvailable =
    authorizationChange !== undefined &&
    resolutionApproved &&
    finalPlanSource !== undefined &&
    finalValidation?.result.valid === true;

  const plans: readonly PlanViewModel[] = orderedPlans.map((plan) => {
    const isApprovedFinal = resolutionApproved && plan.id === finalPlanSource.id;
    const validation = simulation.validations.find(({ planId }) => planId === plan.id);
    const statusPresentation = plan.status === 'APPROVED' && !isApprovedFinal
      ? { label: 'Unavailable', tone: 'neutral' as const }
      : presentPlanStatus(plan.status);
    let explanation: PlanExplanation = { kind: 'neutral', message: 'Plan evidence available for review.' };

    if (isApprovedFinal && authorizationChangeAvailable) {
      explanation = { kind: 'final', unlockPreviousValue: authorizationChange.previousValue, unlockNewValue: authorizationChange.newValue };
    } else if (plan.status === 'NO_SOLUTION') {
      explanation = {
        kind: 'no-solution',
        requiredTomorrow: simulation.noSolutionEvidence.requiredMinimumUnitsTomorrow,
        availableTomorrow: simulation.noSolutionEvidence.availableUnitsTomorrow,
        shortfall: simulation.noSolutionEvidence.requiredMinimumUnitsTomorrow - simulation.noSolutionEvidence.availableUnitsTomorrow,
      };
    } else if (plan.status === 'REJECTED' && authorizationChange !== undefined) {
      const r04 = validation?.result.violations.find(({ ruleId }) => ruleId === 'R-04');
      explanation = {
        kind: 'rejected',
        proposedSubstitutes: plan.substituteQuantityTomorrow,
        clientLimit: authorizationChange.previousValue,
        reason: r04?.message ?? 'The proposal exceeded an active client constraint.',
      };
    } else if (isApprovedFinal) {
      explanation = { kind: 'neutral', message: 'Authorization history is unavailable.' };
    }

    return {
      id: plan.id,
      version: plan.version,
      status: plan.status,
      statusLabel: statusPresentation.label,
      statusTone: statusPresentation.tone,
      isFinal: isApprovedFinal,
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
      validationPassed: isApprovedFinal && finalValidation?.result.valid === true,
      explanation,
    };
  });
  const finalPlan = finalPlanSource === undefined
    ? null
    : plans.find(({ id }) => id === finalPlanSource.id) ?? null;
  const priorPlans = finalPlanSource === undefined
    ? plans
    : plans.slice(0, orderedPlans.findIndex(({ id }) => id === finalPlanSource.id));
  const finalApprovals = resolutionApproved && finalPlanSource !== undefined
    ? finalPlanApprovalRecords
        .map((approval) => ({
          actorId: approval.actorId,
          planId: approval.planId,
          role: approval.actorRole,
          roleLabel: formatLabel(approval.actorRole),
          decision: approval.decision,
          decisionLabel: formatLabel(approval.decision),
          createdAt: formatDateTime(approval.createdAt),
        }))
    : [];
  const neutralReason = finalPlanSource === undefined
    ? 'Final resolution unavailable'
    : finalPlanSource.status !== 'APPROVED'
      ? 'Resolution pending'
      : 'Approval evidence incomplete';

  return {
    header: {
      caseLabel: `${simulation.caseId} · Supply exception`,
      title: resolutionApproved ? `${simulation.updatedCase.requestedQuantity}-unit shortage resolved` : neutralReason,
      requestedQuantity: simulation.updatedCase.requestedQuantity,
      participantCount: simulation.updatedCase.actors.length,
      targetDeliveryDate: formatDateTime(simulation.updatedCase.targetDeliveryDate),
      statusLabel: resolutionApproved ? 'Approved' : 'Unavailable',
      statusTone: resolutionApproved ? 'success' as const : 'neutral' as const,
      summary: resolutionApproved
        ? 'Three parties. Three constraints. One approved recovery plan.'
        : 'The available evidence does not confirm an approved recovery plan.',
    },
    priorPlans,
    finalPlan,
    resolutionAvailable,
    resolutionApproved,
    resolutionMessage: neutralReason,
    progressHeading: resolutionApproved ? 'How the exception was resolved' : 'Plan history',
    progressDescription: resolutionApproved
      ? 'Each version preserves the decision that led to the approved recovery plan.'
      : 'Available plan evidence is shown without claiming a final resolution.',
    authorizationChangeAvailable,
    authorizationChanges: authorizationChangeAvailable ? [{
      actorRole: authorizationChange.actorRole,
      actorLabel: formatLabel(authorizationChange.actorRole),
      field: authorizationChange.field,
      fieldLabel: authorizationFieldLabels[authorizationChange.field],
      previousValue: authorizationChange.previousValue,
      newValue: authorizationChange.newValue,
      reason: authorizationChange.reason,
      createdAt: formatDateTime(authorizationChange.createdAt),
    }] : [],
    finalApprovals,
    events: [...simulation.events]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((event) => ({ id: event.eventId, date: formatDate(event.createdAt), time: formatTime(event.createdAt), type: event.type, typeLabel: formatLabel(event.type), planId: event.planId, actorId: event.actorId, message: event.message })),
  } as const;
};
