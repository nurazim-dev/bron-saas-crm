import type { TransactionClient } from '../appointments/appointments.service.js';
import { AppError } from '../../lib/errors.js';

/**
 * Identity = login credentials shared by several company memberships (User rows).
 * Every membership keeps its own companyId, role and tokenVersion; credentials live on
 * Identity and are mirrored into User.passwordHash for legacy readers.
 */

export interface MemberRef {
  id: string;
  companyId: string;
}

/** Locks the identity row so credential changes and membership creation serialize. */
export async function lockIdentity(tx: TransactionClient, identityId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Identity" WHERE "id" = ${identityId}::uuid FOR UPDATE`;
}

/** All memberships (including soft-deleted ones) that belong to an identity. */
export async function listIdentityMembers(
  tx: TransactionClient,
  identityId: string,
): Promise<MemberRef[]> {
  return tx.$queryRaw<MemberRef[]>`
    SELECT "id", "companyId" FROM "User" WHERE "identityId" = ${identityId}::uuid`;
}

/** True when the identity also belongs to another company than `companyId`. */
export async function isIdentitySharedOutside(
  tx: TransactionClient,
  identityId: string | null,
  companyId: string,
): Promise<boolean> {
  if (!identityId) return false;
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM "User"
    WHERE "identityId" = ${identityId}::uuid AND "companyId" <> ${companyId}::uuid`;
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Staff management in one company must never change credentials that also grant
 * access to another company (owner-of-A cannot take over a shared account).
 */
export async function assertIdentityNotShared(
  tx: TransactionClient,
  identityId: string | null,
  companyId: string,
): Promise<void> {
  if (await isIdentitySharedOutside(tx, identityId, companyId)) {
    throw new AppError(
      'SHARED_IDENTITY',
      409,
      'This account is also used in another company and can only be changed by its holder',
    );
  }
}

function memberScope(members: MemberRef[]) {
  return members.map((m) => ({ userId: m.id, companyId: m.companyId }));
}

/**
 * Revokes every session and pending reset link of every membership of the identity and
 * bumps each membership tokenVersion, so all old access/refresh JWTs stop working.
 */
export async function revokeIdentityAccess(
  tx: TransactionClient,
  members: MemberRef[],
  at: Date,
): Promise<void> {
  if (members.length === 0) return;
  const scope = memberScope(members);
  await tx.authSession.updateMany({
    where: { OR: scope, revokedAt: null },
    data: { revokedAt: at },
  });
  await tx.passwordResetToken.updateMany({
    where: {
      usedAt: null,
      OR: members.map((m) => ({ userId: m.id, user: { companyId: m.companyId } })),
    },
    data: { usedAt: at },
  });
  for (const member of members) {
    await tx.$executeRaw`
      UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1, "updatedAt" = ${at}
      WHERE "id" = ${member.id}::uuid AND "companyId" = ${member.companyId}::uuid`;
  }
}

/** Sets the identity password, mirrors it to memberships and revokes all access. */
export async function applyIdentityPassword(
  tx: TransactionClient,
  identityId: string,
  passwordHash: string | null,
  at: Date,
): Promise<MemberRef[]> {
  await tx.identity.update({
    where: { id: identityId },
    data: { passwordHash, credentialVersion: { increment: 1 } },
  });
  await tx.$executeRaw`
    UPDATE "User" SET "passwordHash" = ${passwordHash}, "updatedAt" = ${at}
    WHERE "identityId" = ${identityId}::uuid`;
  const members = await listIdentityMembers(tx, identityId);
  await revokeIdentityAccess(tx, members, at);
  return members;
}

/** Changes the login email of an identity and of all its memberships atomically. */
export async function applyIdentityEmail(
  tx: TransactionClient,
  identityId: string,
  email: string,
  at: Date,
): Promise<void> {
  await tx.identity.update({ where: { id: identityId }, data: { email } });
  await tx.$executeRaw`
    UPDATE "User"
    SET "email" = ${email}, "emailVerifiedAt" = NULL, "emailVerifyHash" = NULL,
        "emailVerifyExpiresAt" = NULL, "updatedAt" = ${at}
    WHERE "identityId" = ${identityId}::uuid`;
}

/** Removes an identity that no longer has any membership (email released). */
export async function deleteIdentityIfOrphan(
  tx: TransactionClient,
  identityId: string,
): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM "Identity" i WHERE i."id" = ${identityId}::uuid
    AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."identityId" = i."id")`;
}

/** Whether an email is free for a new identity (no identity/membership uses it). */
export async function isLoginEmailTaken(tx: TransactionClient, email: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT ((SELECT count(*) FROM "Identity" WHERE "email" = ${email})
          + (SELECT count(*) FROM "User" WHERE "email" = ${email}))::int AS "n"`;
  return (rows[0]?.n ?? 0) > 0;
}
