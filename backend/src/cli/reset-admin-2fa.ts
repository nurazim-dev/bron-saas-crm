import '../config/utc.js';
import { z } from 'zod';
import { AuditActor } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
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
});

async function main(): Promise<void> {
  const rawEmail = readArg('email') ?? process.env.ADMIN_EMAIL;
  const parsed = schema.safeParse({ email: rawEmail });

  if (!parsed.success) {
    process.stderr.write(`Invalid arguments:\n${z.prettifyError(parsed.error)}\n`);
    process.exitCode = 1;
    return;
  }

  const { email } = parsed.data;
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (!existing) {
    process.stderr.write(`PlatformAdmin not found: ${email}\n`);
    process.exitCode = 1;
    return;
  }

  await prisma.platformAdmin.update({
    where: { id: existing.id },
    data: {
      totpSecretEnc: null,
      totpEnabledAt: null,
      lastTotpStep: null,
      recoveryCodeHashes: [],
      tokenVersion: { increment: 1 },
    },
  });

  await audit(prisma, {
    actorType: AuditActor.SYSTEM,
    action: 'cli.admin_reset_2fa',
    entityType: 'PlatformAdmin',
    entityId: existing.id,
    metadata: { email: existing.email },
  });

  process.stdout.write(`2FA reset for PlatformAdmin: ${existing.email}\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
