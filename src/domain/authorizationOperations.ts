import { authorizationSchema, exceptionCaseSchema } from './schemas.js';
import type { Actor, ActorId, ExceptionCase } from './types.js';

export type AuthorizationField =
  | 'maxAbsorbableAdditionalCost'
  | 'maxSubstituteQuantity'
  | 'latestAcceptedDeliveryDate';

export type AuthorizationReviewAction = 'APPLY' | 'DISCARD';

export type AuthorizationChangeReview = Readonly<{
  actorId: ActorId;
  field: AuthorizationField;
  expectedCurrentValue: string | number;
  newValue: string | number;
  reviewedAction: AuthorizationReviewAction;
}>;

export type ValidatedAuthorizationChange = AuthorizationChangeReview;

export type ResolveAuthorizationValueResult =
  | Readonly<{ success: true; value: string | number }>
  | Readonly<{ success: false; reason: string }>;

export type ValidateAuthorizationChangesResult =
  | Readonly<{
      success: true;
      changes: readonly ValidatedAuthorizationChange[];
    }>
  | Readonly<{
      success: false;
      reason: string;
      issues?: readonly string[];
    }>;

export type ApplyAuthorizationChangesResult =
  | Readonly<{
      success: true;
      updatedCase: ExceptionCase;
      appliedChanges: readonly ValidatedAuthorizationChange[];
      discardedChanges: readonly ValidatedAuthorizationChange[];
    }>
  | Readonly<{
      success: false;
      reason: string;
      issues?: readonly string[];
    }>;

const isAuthorizationField = (field: unknown): field is AuthorizationField =>
  field === 'maxAbsorbableAdditionalCost'
  || field === 'maxSubstituteQuantity'
  || field === 'latestAcceptedDeliveryDate';

const valueForActor = (
  actor: Actor,
  field: AuthorizationField,
): string | number => {
  switch (field) {
    case 'maxAbsorbableAdditionalCost':
      return actor.authorization.maxAbsorbableAdditionalCost;
    case 'maxSubstituteQuantity':
      return actor.authorization.maxSubstituteQuantity;
    case 'latestAcceptedDeliveryDate':
      return actor.authorization.latestAcceptedDeliveryDate;
  }
};

export const resolveAuthorizationValue = (
  exceptionCase: ExceptionCase,
  actorId: ActorId,
  field: unknown,
): ResolveAuthorizationValueResult => {
  if (!isAuthorizationField(field)) {
    return { success: false, reason: 'Unknown authorization field' };
  }
  const actor = exceptionCase.actors.find(({ id }) => id === actorId);
  return actor === undefined
    ? { success: false, reason: 'Authorization actor does not exist' }
    : { success: true, value: valueForActor(actor, field) };
};

const authorizationWithChange = (
  actor: Actor,
  field: AuthorizationField,
  newValue: unknown,
): unknown => {
  switch (field) {
    case 'maxAbsorbableAdditionalCost':
      return { ...actor.authorization, maxAbsorbableAdditionalCost: newValue };
    case 'maxSubstituteQuantity':
      return { ...actor.authorization, maxSubstituteQuantity: newValue };
    case 'latestAcceptedDeliveryDate':
      return { ...actor.authorization, latestAcceptedDeliveryDate: newValue };
  }
};

const parsedChange = (
  input: unknown,
  index: number,
): Readonly<
  | { success: true; change: AuthorizationChangeReview }
  | { success: false; issue: string }
> => {
  if (typeof input !== 'object' || input === null) {
    return { success: false, issue: `changes.${index}: change must be an object` };
  }
  const candidate = input as Record<string, unknown>;
  const allowedKeys = new Set([
    'actorId',
    'field',
    'expectedCurrentValue',
    'newValue',
    'reviewedAction',
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    return { success: false, issue: `changes.${index}: unknown property` };
  }
  if (typeof candidate.actorId !== 'string' || candidate.actorId.trim() === '') {
    return { success: false, issue: `changes.${index}.actorId: required` };
  }
  if (!isAuthorizationField(candidate.field)) {
    return { success: false, issue: `changes.${index}.field: unknown authorization field` };
  }
  if (candidate.reviewedAction !== 'APPLY' && candidate.reviewedAction !== 'DISCARD') {
    return { success: false, issue: `changes.${index}.reviewedAction: invalid action` };
  }
  if (typeof candidate.expectedCurrentValue !== 'string' && typeof candidate.expectedCurrentValue !== 'number') {
    return { success: false, issue: `changes.${index}.expectedCurrentValue: invalid value` };
  }
  if (typeof candidate.newValue !== 'string' && typeof candidate.newValue !== 'number') {
    return { success: false, issue: `changes.${index}.newValue: invalid value` };
  }
  return {
    success: true,
    change: {
      actorId: candidate.actorId as ActorId,
      field: candidate.field,
      expectedCurrentValue: candidate.expectedCurrentValue,
      newValue: candidate.newValue,
      reviewedAction: candidate.reviewedAction,
    },
  };
};

export const validateAuthorizationChanges = (
  exceptionCase: ExceptionCase,
  input: unknown,
): ValidateAuthorizationChangesResult => {
  if (!Array.isArray(input)) {
    return { success: false, reason: 'Authorization changes must be an array' };
  }

  const changes: AuthorizationChangeReview[] = [];
  const issues: string[] = [];
  const targets = new Set<string>();

  input.forEach((candidate, index) => {
    const parsed = parsedChange(candidate, index);
    if (!parsed.success) {
      issues.push(parsed.issue);
      return;
    }
    const { change } = parsed;
    const target = `${change.actorId}:${change.field}`;
    if (targets.has(target)) {
      issues.push(`changes.${index}: duplicate actor and authorization field`);
      return;
    }
    targets.add(target);

    const actor = exceptionCase.actors.find(({ id }) => id === change.actorId);
    if (actor === undefined) {
      issues.push(`changes.${index}.actorId: actor does not exist`);
      return;
    }
    const current = valueForActor(actor, change.field);
    if (current !== change.expectedCurrentValue) {
      issues.push(`changes.${index}.expectedCurrentValue: current value changed`);
      return;
    }
    const authorization = authorizationSchema.safeParse(
      authorizationWithChange(actor, change.field, change.newValue),
    );
    if (!authorization.success) {
      issues.push(`changes.${index}.newValue: violates authorization rules`);
      return;
    }
    changes.push(change);
  });

  return issues.length > 0
    ? { success: false, reason: 'Authorization changes are invalid', issues }
    : { success: true, changes };
};

const applyChangeToActor = (
  actor: Actor,
  change: ValidatedAuthorizationChange,
): Actor => {
  if (actor.id !== change.actorId || change.reviewedAction === 'DISCARD') return actor;
  const parsedAuthorization = authorizationSchema.parse(
    authorizationWithChange(actor, change.field, change.newValue),
  );
  return { ...actor, authorization: parsedAuthorization };
};

export const applyAuthorizationChanges = (
  exceptionCase: ExceptionCase,
  input: unknown,
): ApplyAuthorizationChangesResult => {
  const validation = validateAuthorizationChanges(exceptionCase, input);
  if (!validation.success) return validation;

  const appliedChanges = validation.changes.filter(
    ({ reviewedAction }) => reviewedAction === 'APPLY',
  );
  const discardedChanges = validation.changes.filter(
    ({ reviewedAction }) => reviewedAction === 'DISCARD',
  );
  const actors = exceptionCase.actors.map((actor) =>
    appliedChanges.reduce(applyChangeToActor, actor));
  const updatedCase = exceptionCaseSchema.parse({ ...exceptionCase, actors });

  return {
    success: true,
    updatedCase,
    appliedChanges,
    discardedChanges,
  };
};
