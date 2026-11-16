import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const errors = [];

function walkFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.next' ||
        entry.name === 'dist' ||
        entry.name === 'generated'
      ) {
        continue;
      }
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = [
  ...walkFiles(path.join(ROOT, 'backend/src'), ['.ts', '.tsx']),
  ...walkFiles(path.join(ROOT, 'frontend/src'), ['.ts', '.tsx']),
];

const testFiles = [
  ...walkFiles(path.join(ROOT, 'backend/tests'), ['.ts', '.tsx']),
  ...walkFiles(path.join(ROOT, 'frontend/e2e'), ['.ts', '.tsx']),
];

for (const file of [...sourceFiles, ...testFiles]) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (/\beslint-disable\b/.test(line)) {
      errors.push(`${rel}:${lineNo}: forbidden eslint-disable`);
    }
    if (/@ts-ignore\b|@ts-nocheck\b/.test(line)) {
      errors.push(`${rel}:${lineNo}: forbidden @ts-ignore / @ts-nocheck`);
    }
    if (sourceFiles.includes(file)) {
      if (/:\s*any\b|\bas\s+any\b/.test(line)) {
        errors.push(`${rel}:${lineNo}: forbidden explicit any in source`);
      }
      if (rel.startsWith('backend/src/') && /\bconsole\.log\s*\(/.test(line)) {
        errors.push(`${rel}:${lineNo}: forbidden console.log in backend/src`);
      }
      if (
        !/seed\.ts$/.test(rel) &&
        (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line) ||
          /(?:SECRET|TOKEN|PASSWORD)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{24,}['"]/.test(line))
      ) {
        errors.push(`${rel}:${lineNo}: suspicious hardcoded secret literal`);
      }
    }
    if (testFiles.includes(file)) {
      if (/\b(?:test|it|describe)\.(?:skip|only)\b/.test(line)) {
        errors.push(`${rel}:${lineNo}: forbidden .skip or .only in tests`);
      }
    }
  });
}

// Check tracked .env files (except *.example)
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
for (const rel of tracked) {
  const base = path.basename(rel);
  if ((base === '.env' || base.startsWith('.env.')) && !base.endsWith('.example')) {
    errors.push(`${rel}: tracked .env file is forbidden`);
  }
}

// Check static test count >= baseline in docs/AUTOPILOT.md
const autopilotMd = fs.readFileSync(path.join(ROOT, 'docs/AUTOPILOT.md'), 'utf8');
const backendBaselineMatch = /`backend_tests`:\s*`(\d+)`/.exec(autopilotMd);
const e2eBaselineMatch = /`e2e_scenarios`:\s*`(\d+)`/.exec(autopilotMd);

let staticBackendTests = 0;
for (const file of walkFiles(path.join(ROOT, 'backend/tests'), ['.test.ts'])) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.match(/\b(?:it|test)\s*\(/g);
  staticBackendTests += matches ? matches.length : 0;
}

let staticE2eTests = 0;
for (const file of walkFiles(path.join(ROOT, 'frontend/e2e'), ['.spec.ts'])) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.match(/\btest\s*\(/g);
  staticE2eTests += matches ? matches.length : 0;
}

const backendBaseline = backendBaselineMatch ? Number(backendBaselineMatch[1]) : 0;
const e2eBaseline = e2eBaselineMatch ? Number(e2eBaselineMatch[1]) : 0;

if (staticBackendTests < backendBaseline) {
  errors.push(
    `Backend test count (${staticBackendTests}) is below baseline (${backendBaseline})`,
  );
}
if (staticE2eTests < e2eBaseline) {
  errors.push(`E2E scenario count (${staticE2eTests}) is below baseline (${e2eBaseline})`);
}

if (errors.length > 0) {
  console.error('autopilot-guard FAILED:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(
  `autopilot-guard OK (backend tests: ${staticBackendTests} >= ${backendBaseline}, e2e: ${staticE2eTests} >= ${e2eBaseline})`,
);
