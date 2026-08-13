import { z } from 'zod';

import { sameIsoInstant } from '../domain/dateTime.js';
import {
  actorIdSchema,
  authorizationSchema,
  caseIdSchema,
  caseStatusSchema,
  constraintSchema,
  exceptionCaseSchema,
} from '../domain/schemas.js';
import type { ActorId, Authorization, CaseId, CaseStatus, Constraint, ExceptionCase } from '../domain/types.js';

export type OperationalFactKind = 'COMMERCIAL_ORDER' | 'CLIENT_AUTHORIZATION' | 'PHYSICAL_SUPPLY';
type NonSupplyConstraint = Exclude<Constraint, { type: 'SUPPLY' }>;
type SupplyConstraint = Extract<Constraint, { type: 'SUPPLY' }>;

export type StableCaseActor =
  | Readonly<{ actorId: ActorId; role: 'supplier'; staticConstraints: readonly NonSupplyConstraint[]; staticAuthorization: Authorization }>
  | Readonly<{ actorId: ActorId; role: 'production'; staticConstraints: readonly NonSupplyConstraint[]; staticAuthorization: Authorization }>
  | Readonly<{ actorId: ActorId; role: 'client'; staticConstraints: readonly NonSupplyConstraint[] }>;

export type StableCaseConfiguration = Readonly<{
  caseId: CaseId;
  status: CaseStatus;
  actors: readonly StableCaseActor[];
}>;

export type EvidenceAuthorityPolicy = Readonly<{
  caseId: CaseId;
  authorities: Readonly<Record<OperationalFactKind, string>>;
}>;

type EvidenceBase<K extends OperationalFactKind, P> = Readonly<{
  evidenceId: string;
  sourceId: string;
  caseId: CaseId;
  factKind: K;
  observedAt: string;
  effectiveAt: string;
  payload: P;
}>;

export type CommercialOrderEvidence = EvidenceBase<'COMMERCIAL_ORDER', Readonly<{
  requestedQuantity: number;
  targetDeliveryDate: string;
}>>;
export type ClientAuthorizationEvidence = EvidenceBase<'CLIENT_AUTHORIZATION', Readonly<{
  authorization: Authorization;
}>>;
export type PhysicalSupplyEvidence = EvidenceBase<'PHYSICAL_SUPPLY', Readonly<{
  supplierActorId: ActorId;
  supplies: readonly SupplyConstraint[];
}>>;
export type OperationalEvidence = CommercialOrderEvidence | ClientAuthorizationEvidence | PhysicalSupplyEvidence;

export type EvidenceReference = Readonly<{
  evidenceId: string;
  sourceId: string;
  factKind: OperationalFactKind;
  observedAt: string;
  effectiveAt: string;
}>;

export type EvidenceAssemblyIssue = Readonly<{
  code: string;
  message: string;
  factKind?: OperationalFactKind;
  evidenceId?: string;
}>;

export type EvidenceAssemblyResult =
  | Readonly<{
      status: 'ACCEPTED';
      exceptionCase: ExceptionCase;
      provenance: Readonly<Record<OperationalFactKind, readonly EvidenceReference[]>>;
      authorityBasis: Readonly<Record<OperationalFactKind, string>>;
      temporalBasis: Readonly<{ effectiveAt: string }>;
    }>
  | Readonly<{ status: 'MISSING_EVIDENCE'; missingFactKinds: readonly OperationalFactKind[]; issues: readonly EvidenceAssemblyIssue[] }>
  | Readonly<{ status: 'CONFLICTING_EVIDENCE'; issues: readonly EvidenceAssemblyIssue[] }>
  | Readonly<{ status: 'UNSUPPORTED_EVIDENCE'; issues: readonly EvidenceAssemblyIssue[] }>
  | Readonly<{ status: 'INVALID_EVIDENCE'; issues: readonly EvidenceAssemblyIssue[] }>;

const nonEmpty = z.string().trim().min(1);
const instant = z.string().datetime({ offset: true });
const nonSupplyConstraintSchema = constraintSchema.refine((constraint) => constraint.type !== 'SUPPLY', 'Stable constraints cannot contain SUPPLY');
const stableActorSchema = z.discriminatedUnion('role', [
  z.object({ actorId: actorIdSchema, role: z.literal('supplier'), staticConstraints: z.array(nonSupplyConstraintSchema), staticAuthorization: authorizationSchema }).strict(),
  z.object({ actorId: actorIdSchema, role: z.literal('production'), staticConstraints: z.array(nonSupplyConstraintSchema).min(1), staticAuthorization: authorizationSchema }).strict(),
  z.object({ actorId: actorIdSchema, role: z.literal('client'), staticConstraints: z.array(nonSupplyConstraintSchema).min(1) }).strict(),
]);
const baselineSchema = z.object({
  caseId: caseIdSchema,
  status: caseStatusSchema,
  actors: z.array(stableActorSchema).length(3),
}).strict().superRefine(({ actors }, context) => {
  if (new Set(actors.map(({ actorId }) => actorId)).size !== actors.length) {
    context.addIssue({ code: 'custom', message: 'Stable actor IDs must be unique', path: ['actors'] });
  }
  const roles = new Set(actors.map(({ role }) => role));
  for (const role of ['supplier', 'production', 'client'] as const) {
    if (!roles.has(role)) context.addIssue({ code: 'custom', message: `Missing stable ${role} actor`, path: ['actors'] });
  }
});
const policySchema = z.object({
  caseId: caseIdSchema,
  authorities: z.object({
    COMMERCIAL_ORDER: nonEmpty,
    CLIENT_AUTHORIZATION: nonEmpty,
    PHYSICAL_SUPPLY: nonEmpty,
  }).strict(),
}).strict();
const supplySchema = constraintSchema.refine((constraint): constraint is SupplyConstraint => constraint.type === 'SUPPLY', 'Only SUPPLY constraints are supported');
const envelopeBase = {
  evidenceId: nonEmpty,
  sourceId: nonEmpty,
  caseId: caseIdSchema,
  observedAt: instant,
  effectiveAt: instant,
};
const commercialSchema = z.object({
  ...envelopeBase,
  factKind: z.literal('COMMERCIAL_ORDER'),
  payload: z.object({ requestedQuantity: z.number().int().nonnegative(), targetDeliveryDate: instant }).strict(),
}).strict();
const clientAuthorizationSchema = z.object({
  ...envelopeBase,
  factKind: z.literal('CLIENT_AUTHORIZATION'),
  payload: z.object({ authorization: authorizationSchema }).strict(),
}).strict();
const physicalSupplySchema = z.object({
  ...envelopeBase,
  factKind: z.literal('PHYSICAL_SUPPLY'),
  payload: z.object({ supplierActorId: actorIdSchema, supplies: z.array(supplySchema).min(1) }).strict(),
}).strict();
const evidenceSchema = z.discriminatedUnion('factKind', [commercialSchema, clientAuthorizationSchema, physicalSupplySchema]);
const supportedKinds: readonly OperationalFactKind[] = ['COMMERCIAL_ORDER', 'CLIENT_AUTHORIZATION', 'PHYSICAL_SUPPLY'];

const issue = (code: string, message: string, details: Partial<Pick<EvidenceAssemblyIssue, 'factKind' | 'evidenceId'>> = {}): EvidenceAssemblyIssue => ({ code, message, ...details });
const invalid = (issues: readonly EvidenceAssemblyIssue[]): EvidenceAssemblyResult => ({ status: 'INVALID_EVIDENCE', issues });
const stable = (value: unknown): string => JSON.stringify(value);
const reference = (evidence: OperationalEvidence): EvidenceReference => ({
  evidenceId: evidence.evidenceId,
  sourceId: evidence.sourceId,
  factKind: evidence.factKind,
  observedAt: evidence.observedAt,
  effectiveAt: evidence.effectiveAt,
});

export const assembleTrustedOperationalState = (input: Readonly<{
  effectiveAt: unknown;
  baseline: unknown;
  authorityPolicy: unknown;
  evidence: readonly unknown[];
}>): EvidenceAssemblyResult => {
  const requestedInstant = instant.safeParse(input.effectiveAt);
  const baseline = baselineSchema.safeParse(input.baseline);
  const policy = policySchema.safeParse(input.authorityPolicy);
  if (!requestedInstant.success || !baseline.success || !policy.success || !Array.isArray(input.evidence)) {
    const messages = [
      ...(!requestedInstant.success ? requestedInstant.error.issues.map(({ message }) => `effectiveAt: ${message}`) : []),
      ...(!baseline.success ? baseline.error.issues.map(({ path, message }) => `baseline.${path.join('.')}: ${message}`) : []),
      ...(!policy.success ? policy.error.issues.map(({ path, message }) => `authorityPolicy.${path.join('.')}: ${message}`) : []),
      ...(!Array.isArray(input.evidence) ? ['evidence: must be an array'] : []),
    ];
    return invalid(messages.map((message) => issue('ASSEMBLY_INPUT_INVALID', message)));
  }
  if (baseline.data.caseId !== policy.data.caseId) return invalid([issue('POLICY_CASE_MISMATCH', 'Authority policy and baseline must reference the same case')]);

  const parsed: OperationalEvidence[] = [];
  for (const candidate of input.evidence) {
    if (typeof candidate !== 'object' || candidate === null) return invalid([issue('EVIDENCE_MALFORMED', 'Evidence must be an object')]);
    const record = candidate as Record<string, unknown>;
    if (typeof record.factKind === 'string' && !supportedKinds.includes(record.factKind as OperationalFactKind)) {
      return { status: 'UNSUPPORTED_EVIDENCE', issues: [issue('FACT_KIND_UNSUPPORTED', `Unsupported fact kind: ${record.factKind}`)] };
    }
    const result = evidenceSchema.safeParse(candidate);
    if (!result.success) return invalid(result.error.issues.map(({ path, message }) => issue('EVIDENCE_MALFORMED', `${path.join('.')}: ${message}`)));
    parsed.push(result.data as OperationalEvidence);
  }

  const byId = new Map<string, OperationalEvidence>();
  const deduplicated: OperationalEvidence[] = [];
  for (const evidence of parsed) {
    const previous = byId.get(evidence.evidenceId);
    if (previous !== undefined) {
      if (stable(previous) !== stable(evidence)) return invalid([issue('EVIDENCE_ID_CONFLICT', 'An evidenceId identifies different records', { evidenceId: evidence.evidenceId })]);
      continue;
    }
    byId.set(evidence.evidenceId, evidence);
    deduplicated.push(evidence);
  }

  const unsupported: EvidenceAssemblyIssue[] = [];
  for (const evidence of deduplicated) {
    if (evidence.caseId !== baseline.data.caseId) {
      unsupported.push(issue('EVIDENCE_CASE_UNSUPPORTED', 'Evidence belongs to another case', { factKind: evidence.factKind, evidenceId: evidence.evidenceId }));
    } else if (evidence.sourceId !== policy.data.authorities[evidence.factKind]) {
      unsupported.push(issue('SOURCE_NOT_AUTHORITATIVE', 'Source is not authoritative for this fact kind', { factKind: evidence.factKind, evidenceId: evidence.evidenceId }));
    }
  }
  if (unsupported.length > 0) return { status: 'UNSUPPORTED_EVIDENCE', issues: unsupported };

  const matching = deduplicated.filter((evidence) => sameIsoInstant(evidence.effectiveAt, requestedInstant.data));
  const selected = {} as Record<OperationalFactKind, OperationalEvidence[]>;
  for (const kind of supportedKinds) selected[kind] = matching.filter((evidence) => evidence.factKind === kind);
  const missing = supportedKinds.filter((kind) => selected[kind].length === 0);
  if (missing.length > 0) {
    return {
      status: 'MISSING_EVIDENCE',
      missingFactKinds: missing,
      issues: missing.map((factKind) => issue('REQUIRED_FACT_MISSING', 'No usable authoritative evidence exists for the requested effective instant', { factKind })),
    };
  }

  const conflicts: EvidenceAssemblyIssue[] = [];
  for (const kind of supportedKinds) {
    const claims = selected[kind];
    const first = claims[0]!;
    if (claims.some((claim) => stable(claim.payload) !== stable(first.payload))) {
      conflicts.push(issue('AUTHORITATIVE_CLAIMS_CONFLICT', 'Authoritative claims disagree for the requested effective instant', { factKind: kind }));
    }
  }
  if (conflicts.length > 0) return { status: 'CONFLICTING_EVIDENCE', issues: conflicts };

  const commercial = selected.COMMERCIAL_ORDER[0] as CommercialOrderEvidence;
  const authorization = selected.CLIENT_AUTHORIZATION[0] as ClientAuthorizationEvidence;
  const physical = selected.PHYSICAL_SUPPLY[0] as PhysicalSupplyEvidence;
  const supplier = baseline.data.actors.find(({ role }) => role === 'supplier')!;
  if (physical.payload.supplierActorId !== supplier.actorId) {
    return invalid([issue('SUPPLIER_ID_MISMATCH', 'Physical supply evidence does not reference the configured supplier', { factKind: 'PHYSICAL_SUPPLY', evidenceId: physical.evidenceId })]);
  }
  const actors = baseline.data.actors.map((actor) => {
    if (actor.role === 'supplier') return { id: actor.actorId, role: actor.role, constraints: [...actor.staticConstraints, ...physical.payload.supplies], authorization: actor.staticAuthorization };
    if (actor.role === 'production') return { id: actor.actorId, role: actor.role, constraints: actor.staticConstraints, authorization: actor.staticAuthorization };
    return { id: actor.actorId, role: actor.role, constraints: actor.staticConstraints, authorization: authorization.payload.authorization };
  });
  const assembled = exceptionCaseSchema.safeParse({
    id: baseline.data.caseId,
    status: baseline.data.status,
    requestedQuantity: commercial.payload.requestedQuantity,
    targetDeliveryDate: commercial.payload.targetDeliveryDate,
    actors,
  });
  if (!assembled.success) return invalid(assembled.error.issues.map(({ path, message }) => issue('ASSEMBLED_CASE_INVALID', `${path.join('.')}: ${message}`)));

  return {
    status: 'ACCEPTED',
    exceptionCase: assembled.data,
    provenance: {
      COMMERCIAL_ORDER: selected.COMMERCIAL_ORDER.map(reference),
      CLIENT_AUTHORIZATION: selected.CLIENT_AUTHORIZATION.map(reference),
      PHYSICAL_SUPPLY: selected.PHYSICAL_SUPPLY.map(reference),
    },
    authorityBasis: { ...policy.data.authorities },
    temporalBasis: { effectiveAt: requestedInstant.data },
  };
};
