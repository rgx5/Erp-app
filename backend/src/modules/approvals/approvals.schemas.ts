import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };

export const DOCUMENT_TYPES = ['purchase_order', 'payment', 'journal'] as const;
export const documentType = z.enum(DOCUMENT_TYPES);

export const createPolicySchema = z.strictObject({
  companyId: z.uuid(),
  documentType,
  /** An amount at or above this needs approval. The highest threshold that is met decides how many approvals. */
  thresholdAmount: money,
  requiredApprovals: z.number().int().min(1).max(5),
  /** How many days an approval stays usable after the last approval. */
  validDays: z.number().int().min(1).max(90).default(7),
});
export const updatePolicySchema = z
  .strictObject({ requiredApprovals: z.number().int().min(1).max(5).optional(), validDays: z.number().int().min(1).max(90).optional(), status: z.enum(['active', 'inactive']).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const listPoliciesQuery = z.object({ companyId: z.uuid(), documentType: documentType.optional() });

export const createRequestSchema = z.strictObject({
  companyId: z.uuid(),
  documentType,
  /** Exactly what you will send to the real endpoint (it is validated by the same rules). */
  payload: z.record(z.string(), z.unknown()),
});
export const decisionSchema = z.strictObject({ comment: text(500).optional() });
export const rejectSchema = z.strictObject({ comment: text(500) });
export const cancelSchema = z.strictObject({ reason: text(300).optional() });
export const listRequestsQuery = z.object({
  ...page,
  companyId: z.uuid(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'consumed']).optional(),
  documentType: documentType.optional(),
  mine: z.enum(['true', 'false']).optional(),
});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type ListRequestsQuery = z.infer<typeof listRequestsQuery>;
