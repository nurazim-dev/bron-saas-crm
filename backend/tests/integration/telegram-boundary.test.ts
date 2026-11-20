import { beforeEach, expect, it } from 'vitest';
import { createCompanyFactory, createUserFactory } from '../helpers/factories.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  getMyNotificationSettings,
  createTelegramLinkCode,
  processTelegramUpdate,
} from '../../src/modules/notifications/telegram-link.service.js';
import { prisma } from '../../src/lib/prisma.js';
beforeEach(truncateAllTables);
it('rejects a mismatched actor company at the settings service boundary', async () => {
  const a = await createCompanyFactory(),
    b = await createCompanyFactory();
  const user = await createUserFactory(a.id);
  await expect(
    getMyNotificationSettings({
      userId: user.id,
      companyId: b.id,
      role: user.role,
      tokenVersion: 0,
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('links once and atomically queues confirmation without calling a provider', async () => {
  const company = await createCompanyFactory();
  const user = await createUserFactory(company.id);
  const code = await createTelegramLinkCode({
    userId: user.id,
    companyId: company.id,
    role: user.role,
    tokenVersion: 0,
  });
  await processTelegramUpdate({
    update_id: 78001,
    message: { chat: { id: 123456 }, text: `/start ${code.code}` },
  });
  expect(
    await prisma.outboxMessage.count({
      where: { companyId: company.id, channel: 'TELEGRAM', recipient: '123456' },
    }),
  ).toBe(1);
  await processTelegramUpdate({
    update_id: 78001,
    message: { chat: { id: 123456 }, text: `/start ${code.code}` },
  });
  expect(await prisma.outboxMessage.count({ where: { recipient: '123456' } })).toBe(1);
  expect(
    (await prisma.user.findFirstOrThrow({ where: { id: user.id, companyId: company.id } }))
      .telegramLinkCodeHash,
  ).toBeNull();
});
