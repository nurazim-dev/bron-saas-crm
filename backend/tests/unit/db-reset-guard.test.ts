import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));
const resetScript = fileURLToPath(new URL('../../scripts/db-reset.ts', import.meta.url));

describe('db:reset safety guard', () => {
  it('refuses to run when DATABASE_URL points to a non-localhost host', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('npx', ['tsx', resetScript], {
        cwd: backendRoot,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://zapis:zapis@prod-db.example.com:5432/zapis',
          NODE_ENV: 'development',
        },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const execErr = err as { status?: number; stderr?: string };
      exitCode = execErr.status ?? 1;
      stderr = execErr.stderr ?? '';
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('not localhost');
  });

  it('refuses to run when NODE_ENV is production', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('npx', ['tsx', resetScript], {
        cwd: backendRoot,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://zapis:zapis@localhost:5432/zapis',
          NODE_ENV: 'production',
        },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const execErr = err as { status?: number; stderr?: string };
      exitCode = execErr.status ?? 1;
      stderr = execErr.stderr ?? '';
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('NODE_ENV is production');
  });
});
