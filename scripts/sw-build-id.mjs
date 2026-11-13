// Computes a content hash of all app-shell files and writes it as BUILD_ID into sw.js.
// A changed BUILD_ID changes sw.js, so browsers install the new service worker and
// the old static cache is dropped on activate.
//
// The same BUILD_ID is stamped as ?v=<BUILD_ID> onto every local css/ and js/ reference in
// index.html. A new release therefore always requests new URLs, so neither a still-active
// old service worker nor the browser HTTP cache can pair the new index.html with old CSS/JS.
//
// Icons get their own ICON_VERSION (hash of assets/icons/ only), stamped onto all icon
// references in index.html and manifest.webmanifest and onto the manifest link. Browsers,
// Firefox' icon cache and "Add to Home Screen" therefore fetch a changed logo immediately,
// while unchanged icons keep their URLs (and stay cached) across releases.
//
//   node scripts/sw-build-id.mjs          # update BUILD_ID / ICON_VERSION stamps
//   node scripts/sw-build-id.mjs --check  # exit 1 if anything is stale (used in CI)
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SW_PATH = path.join(ROOT, 'sw.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const MANIFEST_PATH = path.join(ROOT, 'manifest.webmanifest');
const ICON_DIR = 'assets/icons';
const SHELL_FILES = ['index.html', 'manifest.webmanifest'];
const SHELL_DIRS = ['css', 'js', 'vendor', 'assets/icons', 'resources/icons', 'legal'];
const BUILD_ID_PATTERN = /const BUILD_ID = '([^']*)';/;
// href="./css/app.css" / src="./js/x.js", optionally already carrying ?v=...
const ASSET_REF_PATTERN = /((?:href|src)="\.\/(?:css|js)\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g;

// assets/icons/... in href/content/src attributes (also absolute og:image URLs) and in the
// manifest "src" fields, plus the manifest link itself.
const ICON_REF_PATTERN = /(assets\/icons\/[A-Za-z0-9._-]+\.(?:png|ico|svg))(?:\?v=[A-Za-z0-9]*)?(?=")/g;
const MANIFEST_LINK_PATTERN = /(href="manifest\.webmanifest)(?:\?v=[A-Za-z0-9]*)?"/g;

function stripVersions(text) {
  return text
    .replace(ASSET_REF_PATTERN, '$1"')
    .replace(ICON_REF_PATTERN, '$1')
    .replace(MANIFEST_LINK_PATTERN, '$1"');
}

function stampIndex(html, buildId, iconVersion) {
  return html
    .replace(ASSET_REF_PATTERN, `$1?v=${buildId}"`)
    .replace(ICON_REF_PATTERN, `$1?v=${iconVersion}`)
    .replace(MANIFEST_LINK_PATTERN, `$1?v=${iconVersion}"`);
}

function stampManifest(text, iconVersion) {
  return text.replace(ICON_REF_PATTERN, `$1?v=${iconVersion}`);
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

async function hashFiles(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    let content = await readFile(path.join(ROOT, file));
    // Stamped ?v= values must not influence the hash (they are derived from it).
    if (file === 'index.html' || file === 'manifest.webmanifest') {
      content = Buffer.from(stripVersions(content.toString('utf8')));
    }
    hash.update(file);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function computeBuildId() {
  const files = [...SHELL_FILES];
  for (const dir of SHELL_DIRS) files.push(...await listFiles(dir));
  return (await hashFiles(files)).slice(0, 12);
}

export async function computeIconVersion() {
  return (await hashFiles(await listFiles(ICON_DIR))).slice(0, 8);
}

const sw = await readFile(SW_PATH, 'utf8');
const html = await readFile(INDEX_PATH, 'utf8');
const manifest = await readFile(MANIFEST_PATH, 'utf8');
const match = sw.match(BUILD_ID_PATTERN);
if (!match) {
  console.error('sw.js: BUILD_ID declaration not found.');
  process.exit(1);
}
const expected = await computeBuildId();
const iconVersion = await computeIconVersion();
const stampedHtml = stampIndex(html, expected, iconVersion);
const stampedManifest = stampManifest(manifest, iconVersion);

if (process.argv.includes('--check')) {
  const problems = [];
  if (match[1] !== expected) problems.push(`sw.js BUILD_ID is stale (${match[1]} != ${expected})`);
  if (stampedHtml !== html) problems.push('index.html asset/icon versions (?v=) are stale');
  if (stampedManifest !== manifest) problems.push('manifest.webmanifest icon versions (?v=) are stale');
  if (problems.length) {
    console.error(`${problems.join('; ')}. Run: npm run bump-sw`);
    process.exit(1);
  }
  console.log(`BUILD_ID ${expected} and ICON_VERSION ${iconVersion} are up to date.`);
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
  if (stampedManifest !== manifest) {
    await writeFile(MANIFEST_PATH, stampedManifest);
    changed.push('manifest.webmanifest');
  }
  console.log(changed.length
    ? `BUILD_ID ${expected} / ICON_VERSION ${iconVersion} written to ${changed.join(', ')} (BUILD_ID was ${match[1]}).`
    : `Unchanged (BUILD_ID ${expected}, ICON_VERSION ${iconVersion}).`);
}
