import type { AcquisitionPublicRecord } from '../acquisition/contracts.js';

export type AcquisitionProvenance = 'DETERMINISTIC_FIXTURE' | 'LIVE_CALLE';
export type OperationalContextProvenance = 'DETERMINISTIC_PROOF_CONTEXT' | 'CONTROLLED_SANDBOX_CONTEXT';
export type AcquisitionLifecycle = 'CREATING' | 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'UNAVAILABLE';

export type AcquisitionPresentation = Readonly<{
  lifecycle: AcquisitionLifecycle;
  label: string;
  terminal: boolean;
  acquisitionProvenance: AcquisitionProvenance;
  operationalContextProvenance: OperationalContextProvenance;
}>;

export const createAcquisitionPresentation = (record: AcquisitionPublicRecord): AcquisitionPresentation => {
  const base = {
    acquisitionProvenance: 'LIVE_CALLE' as const,
    operationalContextProvenance: 'CONTROLLED_SANDBOX_CONTEXT' as const,
  };
  if (record.status === 'failed') return { ...base, lifecycle: 'FAILED', label: 'Provider failed', terminal: true };
  if (record.status === 'canceled') return { ...base, lifecycle: 'CANCELED', label: 'Provider canceled', terminal: true };
  if (record.status === 'completed') return { ...base, lifecycle: 'COMPLETED', label: 'Acquisition completed', terminal: true };

  const attempts = record.providerEvidence?.recipients.flatMap((recipient) => recipient.attempts) ?? [];
  const latestAttempt = attempts.at(-1);
  if (latestAttempt?.status === 'in_progress') return { ...base, lifecycle: 'IN_PROGRESS', label: 'Conversation in progress', terminal: false };
  if (record.status === 'in_progress') return { ...base, lifecycle: 'IN_PROGRESS', label: 'Acquisition in progress', terminal: false };
  if (record.status === 'creating') return { ...base, lifecycle: 'CREATING', label: 'Creating acquisition', terminal: false };
  if (record.status === 'queued') return { ...base, lifecycle: 'QUEUED', label: 'Acquisition queued', terminal: false };
  return { ...base, lifecycle: 'UNAVAILABLE', label: 'Lifecycle unavailable', terminal: false };
};
