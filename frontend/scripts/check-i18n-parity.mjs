import fs from 'node:fs';
import path from 'node:path';

const dictPath = path.resolve(import.meta.dirname, '../src/lib/i18n/public-dict.ts');
const src = fs.readFileSync(dictPath, 'utf8');

function extractKeys(blockName) {
  const regex = new RegExp(`${blockName}:\\s*\\{([\\s\\S]*?)\\n\\s{2}\\}`, 'm');
  const match = regex.exec(src);
  if (!match) {
    process.stderr.write(`Missing ${blockName} block in public-dict.ts\n`);
    process.exit(1);
  }
  const body = match[1];
  const entries = [];
  const lineRe = /^\s*([a-zA-Z0-9_]+):\s*'([^']*)'/gm;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    entries.push([m[1], m[2]]);
  }
  return entries;
}

const ruMap = new Map(extractKeys('ru'));
const kyMap = new Map(extractKeys('ky'));
const enMap = new Map(extractKeys('en'));

function assertParity(targetName, targetMap) {
  for (const [k, v] of ruMap) {
    if (!targetMap.has(k)) {
      process.stderr.write(`Key missing in ${targetName}: ${k}\n`);
      process.exit(1);
    }
    if (!v || !v.trim()) {
      process.stderr.write(`Empty value in ru for key: ${k}\n`);
      process.exit(1);
    }
  }
  for (const [k, v] of targetMap) {
    if (!ruMap.has(k)) {
      process.stderr.write(`Extra key in ${targetName}: ${k}\n`);
      process.exit(1);
    }
    if (!v || !v.trim()) {
      process.stderr.write(`Empty value in ${targetName} for key: ${k}\n`);
      process.exit(1);
    }
  }
}

assertParity('ky', kyMap);
assertParity('en', enMap);

process.stdout.write(`i18n parity OK (${ruMap.size} keys in ru, ky, and en)\n`);
