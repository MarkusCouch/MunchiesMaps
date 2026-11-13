// Computes a content hash of all app-shell files and writes it as BUILD_ID into sw.js.
// A changed BUILD_ID changes sw.js, so browsers install the new service worker and
// the old static cache is dropped on activate.
//
// The same BUILD_ID is stamped as ?v=<BUILD_ID> onto every local css/ and js/ reference in
// index.html. A new release therefore always requests new URLs, so neither a still-active
// old service worker nor the browser HTTP cache can pair the new index.html with old CSS/JS.
//
//   node scripts/sw-build-id.mjs          # update BUILD_ID in sw.js and index.html
//   node scripts/sw-build-id.mjs --check  # exit 1 if BUILD_ID is stale (used in CI)
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SW_PATH = path.join(ROOT, 'sw.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const SHELL_FILES = ['index.html', 'manifest.webmanifest'];
const SHELL_DIRS = ['css', 'js', 'vendor', 'assets/icons', 'resources/icons', 'legal'];
const BUILD_ID_PATTERN = /const BUILD_ID = '([^']*)';/;
// href="./css/app.css" / src="./js/x.js", optionally already carrying ?v=...
const ASSET_REF_PATTERN = /((?:href|src)="\.\/(?:css|js)\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g;

function stripVersions(html) {
  return html.replace(ASSET_REF_PATTERN, '$1"');
}

function stampVersions(html, buildId) {
  return html.replace(ASSET_REF_PATTERN, `$1?v=${buildId}"`);
}

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
    let content = await readFile(path.join(ROOT, file));
    // The stamped ?v= values must not influence the hash (they are derived from it).
    if (file === 'index.html') content = Buffer.from(stripVersions(content.toString('utf8')));
    hash.update(file);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

const sw = await readFile(SW_PATH, 'utf8');
const html = await readFile(INDEX_PATH, 'utf8');
const match = sw.match(BUILD_ID_PATTERN);
if (!match) {
  console.error('sw.js: BUILD_ID declaration not found.');
  process.exit(1);
}
const expected = await computeBuildId();
const stampedHtml = stampVersions(html, expected);

if (process.argv.includes('--check')) {
  const problems = [];
  if (match[1] !== expected) problems.push(`sw.js BUILD_ID is stale (${match[1]} != ${expected})`);
  if (stampedHtml !== html) problems.push('index.html asset versions (?v=) are stale');
  if (problems.length) {
    console.error(`${problems.join('; ')}. Run: npm run bump-sw`);
    process.exit(1);
  }
  console.log(`sw.js BUILD_ID and index.html asset versions are up to date (${expected}).`);
} else {
  const changed = [];
  if (match[1] !== expected) {
    await writeFile(SW_PATH, sw.replace(BUILD_ID_PATTERN, `const BUILD_ID = '${expected}';`));
    changed.push('sw.js');
  }
  if (stampedHtml !== html) {
    await writeFile(INDEX_PATH, stampedHtml);
    changed.push('index.html');
  }
  console.log(changed.length
    ? `BUILD_ID ${expected} written to ${changed.join(' and ')} (was ${match[1]}).`
    : `BUILD_ID unchanged (${expected}).`);
}
