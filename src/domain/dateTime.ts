import { z } from 'zod';

const isoInstantSchema = z.string().datetime({ offset: true });

export type IsoInstantComparison =
  | Readonly<{ valid: true; order: -1 | 0 | 1 }>
  | Readonly<{ valid: false }>;

export const compareIsoInstants = (
  left: unknown,
  right: unknown,
): IsoInstantComparison => {
  const parsedLeft = isoInstantSchema.safeParse(left);
  const parsedRight = isoInstantSchema.safeParse(right);
  if (!parsedLeft.success || !parsedRight.success) return { valid: false };
  const leftInstant = Date.parse(parsedLeft.data);
  const rightInstant = Date.parse(parsedRight.data);
  if (!Number.isFinite(leftInstant) || !Number.isFinite(rightInstant)) return { valid: false };
  return { valid: true, order: leftInstant === rightInstant ? 0 : leftInstant < rightInstant ? -1 : 1 };
};

export const sameIsoInstant = (left: unknown, right: unknown): boolean => {
  const comparison = compareIsoInstants(left, right);
  return comparison.valid && comparison.order === 0;
};
