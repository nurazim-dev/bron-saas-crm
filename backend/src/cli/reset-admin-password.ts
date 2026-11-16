import '../config/utc.js';
import { z } from 'zod';
import { AuditActor } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { hashPassword } from '../lib/password.js';
import { disconnectPrisma, prisma } from '../lib/prisma.js';

function readArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const eqArg = process.argv.find((a) => a.startsWith(prefix));
  if (eqArg) {
    return eqArg.slice(prefix.length);
  }
  const idx = process.argv.indexOf(`--${flag}`);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(12, 'Admin password must be at least 12 characters').max(128),
});

async function main(): Promise<void> {
  const rawEmail = readArg('email') ?? process.env.ADMIN_EMAIL;
  const rawPassword = readArg('password') ?? process.env.ADMIN_PASSWORD;

  const parsed = schema.safeParse({
    email: rawEmail,
    password: rawPassword,
  });

  if (!parsed.success) {
    process.stderr.write(`Invalid arguments:\n${z.prettifyError(parsed.error)}\n`);
    process.exitCode = 1;
    return;
  }

  const { email, password } = parsed.data;
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (!existing) {
    process.stderr.write(`PlatformAdmin not found: ${email}\n`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.platformAdmin.update({
    where: { id: existing.id },
    data: {
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: { increment: 1 },
    },
  });

  await audit(prisma, {
    actorType: AuditActor.SYSTEM,
    action: 'cli.admin_reset_password',
    entityType: 'PlatformAdmin',
    entityId: existing.id,
    metadata: { email: existing.email },
  });

  process.stdout.write(`Password reset for PlatformAdmin: ${existing.email}\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
