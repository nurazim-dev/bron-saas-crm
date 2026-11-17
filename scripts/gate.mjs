import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const logs = path.join(root, '.tmp/gate');
mkdirSync(logs, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();
const servers = [];
const env = { ...process.env, TZ: 'UTC', FORCE_COLOR: '0' };
const results = [];
let failed = false;

function launch(command, args, name, overrides = {}) {
  const fd = openSync(path.join(logs, `${name}.log`), 'w');
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, ...overrides },
    detached: process.platform !== 'win32',
    stdio: ['ignore', fd, fd],
    shell: process.platform === 'win32' && command === npm,
  });
  closeSync(fd);
  children.add(child);
  child.on('error', () => {});
  child.once('close', () => children.delete(child));
  return child;
}

async function stop(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.once('error', resolve);
      killer.once('close', resolve);
    });
    return;
  }
  const signal = (value) => {
    try {
      process.kill(-child.pid, value);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  signal('SIGTERM');
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      process.kill(-child.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(100);
  }
  signal('SIGKILL');
}

async function command(name, args, overrides) {
  const child = launch(npm, args, name, overrides);
  const timeout = setTimeout(() => void stop(child), 600_000);
  try {
    const [code] = await once(child, 'close');
    if (code !== 0) throw new Error(`exit=${code}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function step(name, action) {
  const start = performance.now();
  let ok = false;
  try {
    await action();
    ok = true;
  } catch (error) {
    failed = true;
    let output = '';
    try {
      output = readFileSync(path.join(logs, `${name}.log`), 'utf8');
    } catch {
      // An internal check may fail before a process creates a log.
    }
    writeFileSync(path.join(logs, `${name}.log`), `${output}\n${error.message}\n`);
  }
  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  const record = { name, ok, seconds };
  results.push(record);
  writeFileSync(path.join(logs, 'summary.json'), JSON.stringify(results, null, 2));
  console.log(`${name}: ${ok ? 'ok' : 'FAIL'} (${ok ? 1 : 0}/1 checks, ${seconds}s)`);
  if (!ok) {
    console.error(
      readFileSync(path.join(logs, `${name}.log`), 'utf8')
        .trimEnd()
        .split('\n')
        .slice(-40)
        .join('\n'),
    );
  }
  return ok;
}

async function portsFree() {
  for (const port of [3000, 4000]) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(port, () => server.close(resolve));
    });
  }
}

async function catalog() {
  // Run in a child so loading backend/.env cannot affect subsequent gate steps.
  process.loadEnvFile(path.join(root, 'backend/.env'));
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query(`SELECT 1 FROM pg_constraint
      WHERE conname = 'Appointment_no_overlapping_active_slots'
      AND conrelid = 'public."Appointment"'::regclass
      AND contype = 'x' AND convalidated`);
    if (result.rowCount !== 1) throw new Error('Appointment exclusion constraint missing');
  } finally {
    await client.end();
  }
}

async function boot() {
  const localEnv = {
    RATE_LIMIT_AUTH_MAX: '50',
    RATE_LIMIT_GLOBAL_MAX: '1000',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASS: '',
    TELEGRAM_BOT_TOKEN: '',
    CLIENT_MESSAGE_PROVIDER: 'LOG',
    WORKER_ENABLED: 'false',
  };
  for (const [name, args] of [
    ['api', ['run', 'start', '-w', 'backend']],
    ['worker', ['run', 'worker', '-w', 'backend']],
    ['frontend', ['run', 'start', '-w', 'frontend']],
  ])
    servers.push(launch(npm, args, name, localEnv));
  for (const url of ['http://localhost:4000/api/v1/health', 'http://localhost:3000/login']) {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (servers.some((child) => child.exitCode !== null || child.signalCode !== null)) {
        throw new Error('A server exited; inspect failing server logs');
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* The server is still starting. */
      }
      await delay(500);
    }
    if (!ready) throw new Error(`Health check failed: ${url}`);
  }
}

async function main() {
  for (const name of ['typecheck', 'lint', 'test', 'build', 'guard']) {
    const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
    if (name === 'guard' && !scripts.guard) continue;
    if (!(await step(name, () => command(name, ['run', name])))) return;
  }
  if (!process.argv.includes('--full')) return;
  if (!(await step('ports-before', portsFree))) return;
  for (const [name, args] of [
    ['db-reset-seed', ['run', 'db:reset']],
    ['migrate-status', ['exec', '-w', 'backend', '--', 'prisma', 'migrate', 'status']],
  ])
    if (!(await step(name, () => command(name, args)))) return;
  if (
    !(await step('constraint', async () => {
      const child = launch(
        process.execPath,
        [fileURLToPath(import.meta.url), '--catalog'],
        'constraint',
      );
      const [code] = await once(child, 'close');
      if (code !== 0) throw new Error(`exit=${code}`);
    }))
  )
    return;
  try {
    if (!(await step('boot-health', boot))) return;
    if (!(await step('e2e', () => command('e2e', ['run', 'test:e2e'], { CI: '' })))) return;
    await step('server-logs', async () => {
      for (const name of ['api', 'worker', 'frontend']) {
        const content = readFileSync(path.join(logs, `${name}.log`), 'utf8');
        if (/error|warn|ECONN|unhandled/i.test(content))
          throw new Error(`${name}: suspicious log output`);
      }
      if (servers.some((child) => child.exitCode !== null || child.signalCode !== null))
        throw new Error('A server exited');
    });
  } finally {
    await step('stop', () => Promise.all(servers.map(stop)));
    await step('ports-after', portsFree);
  }
}

if (process.argv.includes('--catalog')) {
  await catalog();
} else {
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await Promise.all([...children].map(stop));
      process.exit(1);
    });
  try {
    await main();
  } finally {
    await Promise.all([...children].map(stop));
  }
  process.exitCode = failed ? 1 : 0;
}
