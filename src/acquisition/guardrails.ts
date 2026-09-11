import { createHash } from 'node:crypto';

import type { AcquisitionCreateInput, AcquisitionRecord, CreateAcquisitionResult } from './contracts.js';

export type AcquisitionGuardPolicy = Readonly<{
  liveCallingEnabled: boolean;
  allowedClientTokens: ReadonlySet<string>;
  isClientAllowed?: (clientToken: string) => boolean;
  recipientAllowlist?: ReadonlySet<string>;
  perClientDailyLimit: number;
  globalDailyLimit: number;
  cooldownMs: number;
}>;

export type GuardRejection = Extract<CreateAcquisitionResult, { accepted: false }>;

const rejection = (code: GuardRejection['code'], reason: string): GuardRejection => ({ accepted: false, code, reason });
const utcDay = (timestamp: string) => timestamp.slice(0, 10);

export const hashClientToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const evaluateAcquisitionGuard = (
  input: AcquisitionCreateInput,
  records: readonly AcquisitionRecord[],
  policy: AcquisitionGuardPolicy,
  now: string,
): GuardRejection | undefined => {
  if (!policy.liveCallingEnabled) return rejection('LIVE_CALLING_DISABLED', 'Live acquisition is disabled by server policy');
  if (!policy.allowedClientTokens.has(input.clientToken) && policy.isClientAllowed?.(input.clientToken) !== true) return rejection('CLIENT_NOT_ALLOWED', 'Client is not authorized for live acquisition');
  if (policy.recipientAllowlist !== undefined && !policy.recipientAllowlist.has(input.phoneNumber)) {
    return rejection('RECIPIENT_NOT_ALLOWED', 'Recipient is not allowed by server policy');
  }
  const clientHash = hashClientToken(input.clientToken);
  if (records.some((record) => record.clientTokenHash === clientHash && (record.status === 'creating' || record.status === 'queued' || record.status === 'in_progress'))) {
    return rejection('ACTIVE_ACQUISITION_EXISTS', 'This connection already owns an active acquisition');
  }

  if (input.accessMode === 'BYOK') return undefined;
  const today = utcDay(now);
  // Missing accessMode is conservative legacy Hosted usage, never inferred BYOK.
  const todayRecords = records.filter((record) => record.accessMode !== 'BYOK' && utcDay(record.createdAt) === today);
  if (todayRecords.length >= policy.globalDailyLimit) return rejection('CALL_LIMIT_REACHED', 'Global live acquisition limit reached');

  const clientRecords = todayRecords.filter((record) => record.clientTokenHash === clientHash);
  if (clientRecords.length >= policy.perClientDailyLimit) return rejection('CALL_LIMIT_REACHED', 'Client live acquisition limit reached');

  const latest = clientRecords.reduce<AcquisitionRecord | undefined>((candidate, record) =>
    candidate === undefined || Date.parse(record.createdAt) > Date.parse(candidate.createdAt) ? record : candidate, undefined);
  if (latest !== undefined && Date.parse(now) - Date.parse(latest.createdAt) < policy.cooldownMs) {
    return rejection('COOLDOWN_ACTIVE', 'Live acquisition cooldown is active');
  }
  return undefined;
};

const csvSet = (value: string | undefined): ReadonlySet<string> =>
  new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean));
const integer = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export const acquisitionGuardPolicyFromEnvironment = (environment: NodeJS.ProcessEnv): AcquisitionGuardPolicy => ({
  liveCallingEnabled: environment.ACQUISITION_LIVE_ENABLED === 'true',
  allowedClientTokens: csvSet(environment.ACQUISITION_ALLOWED_DEMO_TOKENS),
  ...(environment.ACQUISITION_RECIPIENT_ALLOWLIST === undefined
    ? {}
    : { recipientAllowlist: csvSet(environment.ACQUISITION_RECIPIENT_ALLOWLIST) }),
  perClientDailyLimit: integer(environment.ACQUISITION_PER_CLIENT_DAILY_LIMIT, 1),
  globalDailyLimit: integer(environment.ACQUISITION_GLOBAL_DAILY_LIMIT, 25),
  cooldownMs: integer(environment.ACQUISITION_COOLDOWN_MS, 60_000),
});
