import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function setup(): void {
  const backendRoot = fileURLToPath(new URL('../..', import.meta.url));
  const envTestPath = fileURLToPath(new URL('../../.env.test', import.meta.url));

  if (existsSync(envTestPath)) {
    process.loadEnvFile(envTestPath);
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', TZ: 'UTC' },
  });
}
