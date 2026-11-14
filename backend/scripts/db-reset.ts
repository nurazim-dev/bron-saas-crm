import '../src/config/utc.js';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const envFilePath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('Refusing db:reset: DATABASE_URL is not set.\n');
  process.exit(1);
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  process.stderr.write('Refusing db:reset: DATABASE_URL is not a valid URL.\n');
  process.exit(1);
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!allowedHosts.has(parsedUrl.hostname)) {
  process.stderr.write(
    `Refusing db:reset: DATABASE_URL hostname "${parsedUrl.hostname}" is not localhost.\n`,
  );
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  process.stderr.write('Refusing db:reset: NODE_ENV is production.\n');
  process.exit(1);
}

const backendRoot = fileURLToPath(new URL('..', import.meta.url));

async function resetLocalDevDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
    await client.query('CREATE SCHEMA public;');
  } finally {
    await client.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: { ...process.env, TZ: 'UTC' },
  });

  execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: { ...process.env, TZ: 'UTC' },
  });
}

resetLocalDevDatabase().catch((err: unknown) => {
  process.stderr.write(`db:reset failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
