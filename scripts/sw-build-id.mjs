// Computes a content hash of all app-shell files and writes it as BUILD_ID into sw.js.
// A changed BUILD_ID changes sw.js, so browsers install the new service worker and
// the old static cache is dropped on activate.
//
//   node scripts/sw-build-id.mjs          # update BUILD_ID in sw.js
//   node scripts/sw-build-id.mjs --check  # exit 1 if BUILD_ID is stale (used in CI)
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SW_PATH = path.join(ROOT, 'sw.js');
const SHELL_FILES = ['index.html', 'manifest.webmanifest'];
const SHELL_DIRS = ['js', 'vendor', 'assets/icons', 'resources/icons', 'legal'];
const BUILD_ID_PATTERN = /const BUILD_ID = '([^']*)';/;

async function listFiles(dir) {
  const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(rel));
    else if (entry.isFile() && !entry.name.startsWith('.')) files.push(rel);
  }
  return files;
}

export async function computeBuildId() {
  const files = [...SHELL_FILES];
  for (const dir of SHELL_DIRS) files.push(...await listFiles(dir));
  files.sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(ROOT, file)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

const sw = await readFile(SW_PATH, 'utf8');
const match = sw.match(BUILD_ID_PATTERN);
if (!match) {
  console.error('sw.js: BUILD_ID declaration not found.');
  process.exit(1);
}
const expected = await computeBuildId();

if (process.argv.includes('--check')) {
  if (match[1] !== expected) {
    console.error(`sw.js BUILD_ID is stale (${match[1]} != ${expected}). Run: npm run bump-sw`);
    process.exit(1);
  }
  console.log(`sw.js BUILD_ID is up to date (${expected}).`);
} else if (match[1] === expected) {
  console.log(`sw.js BUILD_ID unchanged (${expected}).`);
} else {
  await writeFile(SW_PATH, sw.replace(BUILD_ID_PATTERN, `const BUILD_ID = '${expected}';`));
  console.log(`sw.js BUILD_ID updated: ${match[1]} -> ${expected}`);
}
