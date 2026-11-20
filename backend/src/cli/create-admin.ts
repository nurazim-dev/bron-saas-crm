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
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12, 'Admin password must be at least 12 characters').max(128),
});

async function main(): Promise<void> {
  const rawEmail = readArg('email') ?? process.env.ADMIN_EMAIL;
  const rawName = readArg('name') ?? process.env.ADMIN_NAME;
  const rawPassword = readArg('password') ?? process.env.ADMIN_PASSWORD;

  const parsed = schema.safeParse({
    email: rawEmail,
    name: rawName,
    password: rawPassword,
  });

  if (!parsed.success) {
    process.stderr.write(`Invalid arguments:\n${z.prettifyError(parsed.error)}\n`);
    process.exitCode = 1;
    return;
  }

  const { email, name, password } = parsed.data;
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    process.stderr.write(`PlatformAdmin with email ${email} already exists.\n`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const created = await prisma.platformAdmin.create({
    data: {
      email,
      name,
      passwordHash,
      isActive: true,
    },
  });

  await audit(prisma, {
    actorType: AuditActor.SYSTEM,
    action: 'cli.admin_create',
    entityType: 'PlatformAdmin',
    entityId: created.id,
    metadata: { email: created.email },
  });

  process.stdout.write(`Created PlatformAdmin: ${created.email} (id: ${created.id})\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
