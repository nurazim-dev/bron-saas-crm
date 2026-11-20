import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import {
  registerOwnerAndCompany,
  loginWithEmailPassword,
} from '../../src/modules/auth/auth.service.js';
import {
  resetPasswordWithToken,
  validatePasswordResetToken,
} from '../../src/modules/auth/password-reset.service.js';
import { inviteStaff } from '../../src/modules/staff/invitations.service.js';
import { truncateAllTables } from '../helpers/db.js';

const app = createApp();
let planLimitToRestore: { id: string; maxStaff: number } | null = null;
async function fixture() {
  return registerOwnerAndCompany({
    companyName: 'Invite Salon',
    ownerName: 'Owner',
    email: 'invite-owner@example.test',
    password: 'Password123!',
    termsAccepted: true,
    businessType: 'BARBERSHOP',
  });
}
describe('Staff invitations', () => {
  afterEach(async () => {
    if (planLimitToRestore)
      await prisma.plan.update({
        where: { id: planLimitToRestore.id },
        data: { maxStaff: planLimitToRestore.maxStaff },
      });
    planLimitToRestore = null;
  });
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });
  it('queues an invitation and lets only a single token consumption set the password', async () => {
    const owner = await fixture();
    const invitation = await inviteStaff(owner.company.id, owner.user.id, {
      name: 'Invited Master',
      email: 'invited@example.test',
    });
    const raw = invitation.url.split('#')[1] ?? '';
    expect(raw).toHaveLength(43);
    const staff = await prisma.user.findFirstOrThrow({
      where: { id: invitation.id, companyId: owner.company.id },
    });
    expect(staff.passwordHash).toBeNull();
    await expect(
      loginWithEmailPassword({ email: 'invited@example.test', password: 'Anything123!' }),
    ).rejects.toMatchObject({ httpStatus: 401 });
    expect(await validatePasswordResetToken(raw)).toEqual({ valid: true });
    await resetPasswordWithToken(raw, 'AcceptedPassword123!');
    await expect(resetPasswordWithToken(raw, 'OtherPassword123!')).rejects.toMatchObject({
      code: 'INVALID_OR_EXPIRED_TOKEN',
    });
    const login = await loginWithEmailPassword({
      email: 'invited@example.test',
      password: 'AcceptedPassword123!',
    });
    expect(login.user.role).toBe('MASTER');
    expect(login.company.id).toBe(owner.company.id);
    const message = await prisma.outboxMessage.findFirstOrThrow({
      where: { companyId: owner.company.id, kind: 'STAFF_INVITATION' },
    });
    expect(message.status).toBe('PENDING');
    expect(
      await prisma.auditLog.count({
        where: { companyId: owner.company.id, action: 'staff.invite' },
      }),
    ).toBe(1);
  });
  it('prevents employees from issuing invitations and enforces server staff limits', async () => {
    const owner = await fixture();
    const invitation = await inviteStaff(owner.company.id, owner.user.id, {
      name: 'Master',
      email: 'invite-master@example.test',
    });
    await resetPasswordWithToken(invitation.url.split('#')[1] ?? '', 'Password123!');
    const employee = await loginWithEmailPassword({
      email: 'invite-master@example.test',
      password: 'Password123!',
    });
    await request(app)
      .post('/api/v1/staff/invite')
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({ name: 'Hacker', email: 'hacker@example.test' })
      .expect(403);
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: owner.company.id },
    });
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: subscription.planId } });
    planLimitToRestore = { id: plan.id, maxStaff: plan.maxStaff };
    await prisma.plan.update({ where: { id: subscription.planId }, data: { maxStaff: 2 } });
    await expect(
      inviteStaff(owner.company.id, owner.user.id, { name: 'Extra', email: 'extra@example.test' }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(await prisma.user.count({ where: { companyId: owner.company.id } })).toBe(2);
  });
});
