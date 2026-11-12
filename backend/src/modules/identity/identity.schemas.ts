import { z } from 'zod';
import { PERMISSIONS } from './permissions.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const email = z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+$/, 'Not a valid email address');
// Length is what matters (NIST 800-63B): long passphrases are fine, composition rules are not imposed. 1024 bounds hashing cost.
export const password = z.string().min(12, 'Use at least 12 characters').max(1024);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Use 3-64 lowercase letters, digits or hyphens');
const permissionList = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).transform((list) => [...new Set(list)]);

export const ownerSchema = z.strictObject({ email, displayName: text(200), password });

/** Used by the platform operator endpoint and by self-signup. A tenant is always created together with its first owner. */
export const provisionTenantSchema = z.strictObject({ name: text(200), slug, owner: ownerSchema });

export const loginSchema = z.strictObject({
  tenant: slug,
  email,
  password: z.string().min(1).max(1024),
  mfaCode: z.string().regex(/^(\d{6}|[A-Za-z0-9]{10})$/, 'Enter the 6-digit code or a recovery code').optional(),
});
export const refreshSchema = z.strictObject({ refreshToken: z.string().min(20).max(300) });
export const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(1024), newPassword: password });
export const mfaActivateSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const mfaDisableSchema = z.strictObject({ password: z.string().min(1).max(1024), code: z.string().regex(/^(\d{6}|[A-Za-z0-9]{10})$/) });

export const createUserSchema = z.strictObject({ email, displayName: text(200), password, roleIds: z.array(z.uuid()).max(50).default([]) });
export const updateUserSchema = z
  .strictObject({ displayName: text(200).optional(), status: z.enum(['active', 'disabled']).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
export const setUserRolesSchema = z.strictObject({ roleIds: z.array(z.uuid()).max(50) });

export const createRoleSchema = z.strictObject({ name: text(100), description: text(500).optional(), permissions: permissionList });
export const updateRoleSchema = z
  .strictObject({ name: text(100).optional(), description: text(500).nullable().optional(), permissions: permissionList.optional() })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

export const createApiKeySchema = z.strictObject({
  name: text(100),
  permissions: permissionList,
  expiresAt: z.iso.datetime().optional(),
});

export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
