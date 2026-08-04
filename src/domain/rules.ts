import type {
  Actor,
  ActorRole,
  Constraint,
  ExceptionCase,
  Plan,
} from './types.js';

export type RuleId =
  | 'R-01'
  | 'R-02'
  | 'R-03'
  | 'R-04'
  | 'R-05'
  | 'R-06'
  | 'R-07'
  | 'R-08'
  | 'R-09'
  | 'R-10';

export type RuleViolation = Readonly<{
  ruleId: RuleId;
  field: keyof Plan;
  actorRole: ActorRole | null;
  message: string;
  expected: number | string;
  actual: number | string;
}>;

export type ValidationResult = Readonly<{
  valid: boolean;
  violations: readonly RuleViolation[];
}>;

export type Rule = (
  exceptionCase: ExceptionCase,
  plan: Plan,
) => readonly RuleViolation[];

const COST_TOLERANCE = 0.01;

type SupplyConstraint = Extract<Constraint, { type: 'SUPPLY' }>;
type MinimumDeliveryConstraint = Extract<
  Constraint,
  { type: 'MINIMUM_DELIVERY' }
>;

const isSupplyConstraint = (
  constraint: Constraint,
): constraint is SupplyConstraint => constraint.type === 'SUPPLY';

const isMinimumDeliveryConstraint = (
  constraint: Constraint,
): constraint is MinimumDeliveryConstraint =>
  constraint.type === 'MINIMUM_DELIVERY';

const actorByRole = (exceptionCase: ExceptionCase, role: ActorRole): Actor => {
  const actor = exceptionCase.actors.find((candidate) => candidate.role === role);

  if (actor === undefined) {
    throw new Error(`Missing required actor: ${role}`);
  }

  return actor;
};

const tomorrowQuantity = (plan: Plan): number =>
  plan.originalQuantityTomorrow + plan.substituteQuantityTomorrow;

const totalQuantity = (plan: Plan): number =>
  tomorrowQuantity(plan) + plan.originalQuantityLater;

const minimumTomorrowQuantity = (
  actor: Actor,
  targetDeliveryDate: string,
): number =>
  Math.max(
    ...actor.constraints
      .filter(isMinimumDeliveryConstraint)
      .filter((constraint) => constraint.deliveryDate === targetDeliveryDate)
      .map((constraint) => constraint.minimumRequiredQuantity),
  );

const violation = (
  ruleId: RuleId,
  field: keyof Plan,
  actorRole: ActorRole | null,
  message: string,
  expected: number | string,
  actual: number | string,
): readonly RuleViolation[] => [
  { ruleId, field, actorRole, message, expected, actual },
];

const validateR01: Rule = (exceptionCase, plan) => {
  const actual = totalQuantity(plan);

  return actual === exceptionCase.requestedQuantity
    ? []
    : violation(
        'R-01',
        'originalQuantityLater',
        null,
        'Plan total must equal the requested quantity',
        exceptionCase.requestedQuantity,
        actual,
      );
};

const validateMinimumTomorrow = (
  ruleId: 'R-02' | 'R-03',
  role: 'production' | 'client',
): Rule =>
  (exceptionCase, plan) => {
    const minimum = minimumTomorrowQuantity(
      actorByRole(exceptionCase, role),
      exceptionCase.targetDeliveryDate,
    );
    const actual = tomorrowQuantity(plan);

    return actual >= minimum
      ? []
      : violation(
          ruleId,
          'originalQuantityTomorrow',
          role,
          `Tomorrow delivery must meet the ${role} minimum`,
          minimum,
          actual,
        );
  };

const validateR04: Rule = (exceptionCase, plan) => {
  const maximum = actorByRole(exceptionCase, 'client').authorization
    .maxSubstituteQuantity;

  return plan.substituteQuantityTomorrow <= maximum
    ? []
    : violation(
        'R-04',
        'substituteQuantityTomorrow',
        'client',
        'Tomorrow substitute quantity exceeds the client authorization',
        maximum,
        plan.substituteQuantityTomorrow,
      );
};

const absorbedCostRule = (
  ruleId: 'R-05' | 'R-06' | 'R-07',
  role: ActorRole,
  field:
    | 'clientAdditionalCost'
    | 'supplierAbsorbedCost'
    | 'productionAbsorbedCost',
): Rule =>
  (exceptionCase, plan) => {
    const maximum = actorByRole(exceptionCase, role).authorization
      .maxAbsorbableAdditionalCost;
    const actual = plan[field];

    return actual <= maximum
      ? []
      : violation(
          ruleId,
          field,
          role,
          `${role} cost exceeds its authorized margin`,
          maximum,
          actual,
        );
  };

const validateR08: Rule = (exceptionCase, plan) => {
  const clientMaximum = actorByRole(exceptionCase, 'client').authorization
    .latestAcceptedDeliveryDate;
  const productionMaximum = actorByRole(exceptionCase, 'production').authorization
    .latestAcceptedDeliveryDate;
  const maximum =
    Date.parse(clientMaximum) <= Date.parse(productionMaximum)
      ? clientMaximum
      : productionMaximum;

  return Date.parse(plan.laterDeliveryDate) <= Date.parse(maximum)
    ? []
    : violation(
        'R-08',
        'laterDeliveryDate',
        null,
        'Later delivery exceeds the most restrictive accepted date',
        maximum,
        plan.laterDeliveryDate,
      );
};

const validateR09: Rule = (exceptionCase, plan) => {
  const supplier = actorByRole(exceptionCase, 'supplier');
  const substituteUnitAdditionalCost = supplier.constraints.find(
    (constraint): constraint is SupplyConstraint =>
      isSupplyConstraint(constraint) &&
      constraint.substituteQuantity > 0 &&
      constraint.deliveryDate === exceptionCase.targetDeliveryDate,
  )?.substituteUnitAdditionalCost;

  if (substituteUnitAdditionalCost === undefined) {
    throw new Error('Missing supplier substitute cost for the target date');
  }

  const expected =
    plan.substituteQuantityTomorrow * substituteUnitAdditionalCost;
  const actual =
    plan.clientAdditionalCost +
    plan.supplierAbsorbedCost +
    plan.productionAbsorbedCost;
  const floatingPointEpsilon =
    Number.EPSILON * Math.max(Math.abs(expected), Math.abs(actual), 1);

  return Math.abs(expected - actual) <= COST_TOLERANCE + floatingPointEpsilon
    ? []
    : violation(
        'R-09',
        'clientAdditionalCost',
        null,
        'Substitute cost does not match the specified cost allocation formula',
        expected,
        actual,
      );
};

/*
 * With the current Plan model, R-10 uses the same three quantity fields and
 * equality as R-01. Both rules are intentionally evaluated and reported so
 * their functional identities remain visible without inventing another check.
 */
const validateR10: Rule = (exceptionCase, plan) => {
  const actual = totalQuantity(plan);

  return actual === exceptionCase.requestedQuantity
    ? []
    : violation(
        'R-10',
        'originalQuantityLater',
        null,
        'Plan quantities must be coherent with the requested quantity',
        exceptionCase.requestedQuantity,
        actual,
      );
};

export const deterministicRules: readonly Rule[] = [
  validateR01,
  validateMinimumTomorrow('R-02', 'production'),
  validateMinimumTomorrow('R-03', 'client'),
  validateR04,
  absorbedCostRule('R-05', 'client', 'clientAdditionalCost'),
  absorbedCostRule('R-06', 'supplier', 'supplierAbsorbedCost'),
  absorbedCostRule('R-07', 'production', 'productionAbsorbedCost'),
  validateR08,
  validateR09,
  validateR10,
];
