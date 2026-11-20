import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { resetClock, useFakeClock } from '../../src/lib/clock.js';
import { registerOwnerAndCompany } from '../../src/modules/auth/auth.service.js';
import {
  confirmEmailVerification,
  requestEmailVerification,
} from '../../src/modules/auth/email-verification.service.js';
import { updateStaffForCompany } from '../../src/modules/staff/staff.service.js';
import { truncateAllTables } from '../helpers/db.js';

async function fixture() {
  return registerOwnerAndCompany({
    companyName: 'Verified Salon',
    ownerName: 'Owner',
    email: 'verify@example.test',
    password: 'Password123!',
    businessType: 'BARBERSHOP',
    termsAccepted: true,
  });
}
async function readToken(companyId: string) {
  const row = await prisma.outboxMessage.findFirstOrThrow({
    where: { companyId, kind: 'EMAIL_VERIFICATION' },
    orderBy: { createdAt: 'desc' },
  });
  const payload = row.payload as { verifyUrl: string };
  return payload.verifyUrl.split('#')[1] ?? '';
}
describe('Email verification', () => {
  beforeEach(async () => {
    await truncateAllTables();
    useFakeClock('2026-11-17T10:00:00Z');
  });
  afterEach(() => resetClock());
  it('queues mail and atomically consumes a high entropy link only once', async () => {
    const auth = await fixture();
    await requestEmailVerification(auth.user.id, auth.company.id);
    const token = await readToken(auth.company.id);
    expect(token).toHaveLength(43);
    const row = await prisma.user.findFirstOrThrow({
      where: { id: auth.user.id, companyId: auth.company.id },
    });
    expect(row.emailVerifyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.emailVerifyHash).not.toBe(token);
    const results = await Promise.allSettled([
      confirmEmailVerification(token),
      confirmEmailVerification(token),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const updated = await prisma.user.findFirstOrThrow({
      where: { id: auth.user.id, companyId: auth.company.id },
    });
    expect(updated.emailVerifiedAt).not.toBeNull();
    expect(updated.emailVerifyHash).toBeNull();
  });
  it('throttles resend, rejects expired links and cannot use another tenant', async () => {
    const auth = await fixture();
    await expect(
      requestEmailVerification(auth.user.id, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ httpStatus: 404 });
    await requestEmailVerification(auth.user.id, auth.company.id);
    await expect(requestEmailVerification(auth.user.id, auth.company.id)).rejects.toMatchObject({
      httpStatus: 429,
    });
    const token = await readToken(auth.company.id);
    useFakeClock('2026-11-17T11:00:00Z');
    await expect(confirmEmailVerification(token)).rejects.toMatchObject({
      code: 'INVALID_OR_EXPIRED_TOKEN',
    });
  });
  it('invalidates a link and verified status when an owner changes the staff email', async () => {
    const auth = await fixture();
    const staffIdentity = await prisma.identity.create({
      data: {
        email: 'master-verify@example.test',
        passwordHash: 'not-used',
        lastCompanyId: auth.company.id,
      },
    });
    const staff = await prisma.user.create({
      data: {
        companyId: auth.company.id,
        identityId: staffIdentity.id,
        role: 'MASTER',
        name: 'Master',
        email: 'master-verify@example.test',
        passwordHash: 'not-used',
      },
    });
    await requestEmailVerification(staff.id, auth.company.id);
    const token = await readToken(auth.company.id);
    await updateStaffForCompany(auth.company.id, staff.id, { email: 'new-master@example.test' });
    await expect(confirmEmailVerification(token)).rejects.toMatchObject({
      code: 'INVALID_OR_EXPIRED_TOKEN',
    });
    const row = await prisma.user.findFirstOrThrow({
      where: { id: staff.id, companyId: auth.company.id },
    });
    expect(row.emailVerifiedAt).toBeNull();
    expect(row.emailVerifyHash).toBeNull();
  });
});
