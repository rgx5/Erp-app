import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import { AppError, unauthorized } from '../../platform/http/errors.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AuditService } from '../../platform/services/audit.service.js';
import type { Tx } from '../../platform/database/database.js';
import { SECRET_BOX, TOKENS } from './crypto.providers.js';
import { mfaRecoveryCodes, sessions, tenantDirectory, users } from './identity.schema.js';
import type { LoginInput } from './identity.schemas.js';
import { burnPasswordTime, hashPassword, needsRehash, verifyPassword } from './password.js';
import type { Principal } from './principal.js';
import { compactUuid, expandUuid, sha256 } from './principal.service.js';
import type { SecretBox } from './secret-box.js';
import type { TokenService } from './tokens.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

export type UserRow = typeof users.$inferSelect;

export interface ClientInfo { ip?: string | undefined; userAgent?: string | undefined }

export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const invalidCredentials = () => new AppError(401, 'invalid_credentials', 'The tenant, email or password is incorrect');
const mfaRequired = () => new AppError(401, 'mfa_required', 'Enter the code from your authenticator app, or a recovery code');
const badRefresh = () => unauthorized('The refresh token is invalid, expired or already used');
const recoveryAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type LoginOutcome =
  | { ok: true; user: UserRow; tokens: TokenPair }
  | { ok: false; reason: 'credentials' | 'mfa_required' };

@Injectable()
export class AuthService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(ENV) private readonly env: Env,
    @Inject(TOKENS) private readonly tokens: TokenService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private auditAs(tx: Tx, tenantId: string, userId: string, action: string, outcome: 'success' | 'failure' = 'success', details: Record<string, unknown> = {}) {
    return this.audit.record(tx, tenantId, { action, entityType: 'user', entityId: userId, outcome, details, actor: { type: 'user', id: userId } });
  }

  /**
   * Signs in with tenant slug + email + password (+ a one-time code when the user enrolled in MFA). Every failure to
   * identify the account answers the same 401, takes similar time, and a locked account is indistinguishable from a wrong password.
   */
  async login(input: LoginInput, client: ClientInfo): Promise<{ user: UserRow; tokens: TokenPair }> {
    const [directory] = await this.uow.outsideTenant((tx) => tx.select().from(tenantDirectory).where(eq(tenantDirectory.slug, input.tenant)));
    if (!directory) {
      await burnPasswordTime(input.password);
      throw invalidCredentials();
    }
    const tenantId = directory.tenantId;

    // Verification (slow, CPU-bound) happens outside any transaction; only the outcome is written.
    const [candidate] = await this.uow.inTenant(tenantId, (tx) => tx.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.email, input.email))), { readOnly: true });
    if (!candidate) {
      await burnPasswordTime(input.password);
      throw invalidCredentials();
    }
    const passwordOk = await verifyPassword(candidate.passwordHash, input.password);

    const outcome = await this.uow.inTenant(tenantId, async (tx): Promise<LoginOutcome> => {
      // Re-read under a row lock so two concurrent attempts cannot both slip under the failure limit.
      const [user] = await tx.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, candidate.id))).for('update');
      if (!user || user.status !== 'active') return { ok: false, reason: 'credentials' };
      const now = new Date();
      if (user.lockedUntil && user.lockedUntil > now) return { ok: false, reason: 'credentials' };

      let success = passwordOk;
      let needsCode = false;
      let lastStep: number | undefined;
      if (success && user.mfaEnabled) {
        if (!input.mfaCode) needsCode = true;
        else {
          const second = await this.checkSecondFactor(tx, user, input.mfaCode);
          success = second.ok;
          lastStep = second.step;
        }
      }
      if (needsCode) return { ok: false, reason: 'mfa_required' };
      if (!success) {
        const failures = user.failedLoginCount + 1;
        const lock = failures >= this.env.LOGIN_MAX_FAILURES;
        await tx
          .update(users)
          .set({ failedLoginCount: lock ? 0 : failures, lockedUntil: lock ? new Date(now.getTime() + this.env.LOGIN_LOCKOUT_SECONDS * 1000) : null })
          .where(and(eq(users.tenantId, tenantId), eq(users.id, user.id)));
        await this.auditAs(tx, tenantId, user.id, 'auth.login_failed', 'failure', { failures });
        if (lock) await this.auditAs(tx, tenantId, user.id, 'auth.account_locked', 'failure', { lockoutSeconds: this.env.LOGIN_LOCKOUT_SECONDS });
        return { ok: false, reason: 'credentials' };
      }
      const rehash = needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(input.password) } : {};
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, ...(lastStep !== undefined ? { mfaLastStep: lastStep } : {}), ...rehash })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, user.id)));
      const tokens = await this.startSession(tx, tenantId, user.id, uuidv7(), client);
      await this.auditAs(tx, tenantId, user.id, 'auth.login_succeeded', 'success', { mfa: user.mfaEnabled });
      return { ok: true, user, tokens };
    });

    if (!outcome.ok) throw outcome.reason === 'mfa_required' ? mfaRequired() : invalidCredentials();
    return { user: outcome.user, tokens: outcome.tokens };
  }

  /** Exchanges a refresh token for a new pair. The old token is spent; presenting it again revokes the whole session family. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<{ user: UserRow; tokens: TokenPair }> {
    const [prefix, tenantHex, secret, extra] = refreshToken.split('_');
    const tenantId = prefix === 'rt' && tenantHex ? expandUuid(tenantHex) : undefined;
    if (!tenantId || !secret || extra !== undefined) throw badRefresh();

    type Outcome = { ok: true; user: UserRow; tokens: TokenPair } | { ok: false };
    const outcome = await this.uow.inTenant(tenantId, async (tx): Promise<Outcome> => {
      const [session] = await tx.select().from(sessions).where(and(eq(sessions.tenantId, tenantId), eq(sessions.tokenHash, sha256(secret)))).for('update');
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return { ok: false };
      if (session.usedAt) {
        await this.revokeFamily(tx, tenantId, session.familyId, 'refresh_token_reuse');
        await this.auditAs(tx, tenantId, session.userId, 'auth.refresh_reuse_detected', 'failure', { familyId: session.familyId });
        return { ok: false };
      }
      const [user] = await tx.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, session.userId)));
      if (!user || user.status !== 'active') return { ok: false };
      await tx.update(sessions).set({ usedAt: new Date() }).where(and(eq(sessions.tenantId, tenantId), eq(sessions.id, session.id)));
      return { ok: true, user, tokens: await this.startSession(tx, tenantId, user.id, session.familyId, client) };
    });
    if (!outcome.ok) throw badRefresh();
    return { user: outcome.user, tokens: outcome.tokens };
  }

  async logout(principal: Principal): Promise<void> {
    if (!principal.sessionId) return;
    const sessionId = principal.sessionId;
    await this.uow.inTenant(principal.tenantId, async (tx) => {
      await this.revokeFamily(tx, principal.tenantId, sessionId, 'logout');
      await this.auditAs(tx, principal.tenantId, principal.userId, 'auth.logout');
    });
  }

  async changePassword(principal: Principal, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.requireUser(principal);
    if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new AppError(403, 'invalid_credentials', 'The current password is incorrect');
    const passwordHash = await hashPassword(newPassword);
    await this.uow.inTenant(principal.tenantId, async (tx) => {
      await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(and(eq(users.tenantId, principal.tenantId), eq(users.id, user.id)));
      // Every other device is signed out; this one keeps its session.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'password_changed' })
        .where(and(eq(sessions.tenantId, principal.tenantId), eq(sessions.userId, user.id), isNull(sessions.revokedAt), principal.sessionId ? ne(sessions.familyId, principal.sessionId) : undefined));
      await this.auditAs(tx, principal.tenantId, user.id, 'auth.password_changed');
    });
  }

  async me(principal: Principal): Promise<UserRow> {
    return this.requireUser(principal);
  }

  // ---- MFA --------------------------------------------------------------------------------------------------------

  /** Step 1: creates a pending secret. MFA is not enforced until the user proves the app works (activate). */
  async mfaEnroll(principal: Principal): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.requireUser(principal);
    if (user.mfaEnabled) throw new AppError(409, 'mfa_already_enabled', 'Multi-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.uow.inTenant(principal.tenantId, (tx) =>
      tx.update(users).set({ mfaSecretEnc: this.box.seal(secret, `${principal.tenantId}:${user.id}`) }).where(and(eq(users.tenantId, principal.tenantId), eq(users.id, user.id))),
    );
    return { secret, otpauthUri: otpauthUri(secret, user.email, 'OneSyncERP') };
  }

  /** Step 2: a valid code turns MFA on and returns one-time recovery codes (shown only now). */
  async mfaActivate(principal: Principal, code: string): Promise<string[]> {
    const user = await this.requireUser(principal);
    if (user.mfaEnabled || !user.mfaSecretEnc) throw new AppError(409, 'mfa_not_pending', 'Start enrolment first');
    const step = verifyTotp(this.box.open(user.mfaSecretEnc, `${principal.tenantId}:${user.id}`), code);
    if (step === undefined) throw new AppError(422, 'invalid_code', 'That code is not correct');
    const codes = Array.from({ length: 10 }, () => Array.from(randomBytes(10), (b) => recoveryAlphabet[b % recoveryAlphabet.length]).join(''));
    await this.uow.inTenant(principal.tenantId, async (tx) => {
      await tx.update(users).set({ mfaEnabled: true, mfaLastStep: step }).where(and(eq(users.tenantId, principal.tenantId), eq(users.id, user.id)));
      await tx.insert(mfaRecoveryCodes).values(codes.map((c) => ({ tenantId: principal.tenantId, id: uuidv7(), userId: user.id, codeHash: sha256(c) })));
      await this.auditAs(tx, principal.tenantId, user.id, 'auth.mfa_enabled');
    });
    return codes;
  }

  async mfaDisable(principal: Principal, password: string, code: string): Promise<void> {
    const user = await this.requireUser(principal);
    if (!user.mfaEnabled) throw new AppError(409, 'mfa_not_enabled', 'Multi-factor authentication is not enabled');
    if (!(await verifyPassword(user.passwordHash, password))) throw new AppError(403, 'invalid_credentials', 'The password is incorrect');
    await this.uow.inTenant(principal.tenantId, async (tx) => {
      const second = await this.checkSecondFactor(tx, user, code);
      if (!second.ok) throw new AppError(422, 'invalid_code', 'That code is not correct');
      await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null }).where(and(eq(users.tenantId, principal.tenantId), eq(users.id, user.id)));
      await tx
        .update(mfaRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(mfaRecoveryCodes.tenantId, principal.tenantId), eq(mfaRecoveryCodes.userId, user.id), isNull(mfaRecoveryCodes.usedAt)));
      await this.auditAs(tx, principal.tenantId, user.id, 'auth.mfa_disabled');
    });
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  /** A TOTP code (each step usable once) or a single-use recovery code. */
  private async checkSecondFactor(tx: Tx, user: UserRow, code: string): Promise<{ ok: boolean; step?: number }> {
    if (/^\d{6}$/.test(code)) {
      if (!user.mfaSecretEnc) return { ok: false };
      const step = verifyTotp(this.box.open(user.mfaSecretEnc, `${user.tenantId}:${user.id}`), code);
      if (step === undefined || (user.mfaLastStep !== null && step <= user.mfaLastStep)) return { ok: false }; // replay of a used step
      return { ok: true, step };
    }
    const used = await tx
      .update(mfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(mfaRecoveryCodes.tenantId, user.tenantId), eq(mfaRecoveryCodes.userId, user.id), eq(mfaRecoveryCodes.codeHash, sha256(code.toUpperCase())), isNull(mfaRecoveryCodes.usedAt)))
      .returning({ id: mfaRecoveryCodes.id });
    return { ok: used.length === 1 };
  }

  private async startSession(tx: Tx, tenantId: string, userId: string, familyId: string, client: ClientInfo): Promise<TokenPair> {
    const secret = randomBytes(32).toString('hex');
    await tx.insert(sessions).values({
      tenantId,
      id: uuidv7(),
      familyId,
      userId,
      tokenHash: sha256(secret),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000),
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      ipAddress: client.ip?.slice(0, 64) ?? null,
    });
    return {
      tokenType: 'Bearer',
      accessToken: this.tokens.issue({ sub: userId, tid: tenantId, sid: familyId }, this.env.ACCESS_TOKEN_TTL_SECONDS),
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: `rt_${compactUuid(tenantId)}_${secret}`,
    };
  }

  private async revokeFamily(tx: Tx, tenantId: string, familyId: string, reason: string): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.tenantId, tenantId), eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  private async requireUser(principal: Principal): Promise<UserRow> {
    if (principal.kind !== 'user') throw new AppError(403, 'forbidden', 'This action needs a signed-in user, not an API key');
    const [user] = await this.uow.inTenant(principal.tenantId, (tx) => tx.select().from(users).where(and(eq(users.tenantId, principal.tenantId), eq(users.id, principal.userId))), { readOnly: true });
    if (!user) throw unauthorized();
    return user;
  }
}
