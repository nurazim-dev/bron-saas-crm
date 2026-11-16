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

const ruEntries = extractKeys('ru');
const kyEntries = extractKeys('ky');
const ruMap = new Map(ruEntries);
const kyMap = new Map(kyEntries);

for (const [k, v] of ruMap) {
  if (!kyMap.has(k)) {
    process.stderr.write(`Key missing in ky: ${k}\n`);
    process.exit(1);
  }
  if (!v || !v.trim()) {
    process.stderr.write(`Empty value in ru for key: ${k}\n`);
    process.exit(1);
  }
}

for (const [k, v] of kyMap) {
  if (!ruMap.has(k)) {
    process.stderr.write(`Extra key in ky: ${k}\n`);
    process.exit(1);
  }
  if (!v || !v.trim()) {
    process.stderr.write(`Empty value in ky for key: ${k}\n`);
    process.exit(1);
  }
}

process.stdout.write(`i18n parity OK (${ruMap.size} keys in ru and ky)\n`);
