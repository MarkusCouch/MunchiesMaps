// Generates static, crawlable landing pages per category and country plus sitemap.xml.
//
//   node scripts/generate-seo-pages.mjs
//
// Output (all generated, do not edit by hand):
//   map/index.html                       – overview of all countries and categories
//   map/<category>/<country>/index.html  – e.g. map/drinking-water/slovenia/
//   map/seo.css
//   sitemap.xml
//
// Each landing page has a static H1, POI counts per region, the data date and a deep link
// into the map (index.html?c=<category>&a=<lat>&o=<lng>&z=<zoom>), which the app opens
// directly without any extra click.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SITE_URL = 'https://nightrides.cc/munchiesmaps/';
const OUT_DIR = path.join(ROOT, 'map');
const GEOJSON_DIR = path.join(ROOT, 'resources', 'geojson');
const MIN_POIS_FOR_PAGE = 5;
const DEEP_LINK_ZOOM = 11;

// URL slug + wording per category id (ids come from resources/geojson/manifest.json).
const CATEGORY_META = {
  drinking_water: { slug: 'drinking-water', singular: 'drinking water spot', plural: 'drinking water spots', title: 'Drinking water' },
  toilets_public: { slug: 'public-toilets', singular: 'public toilet', plural: 'public toilets', title: 'Public toilets' },
  fuel: { slug: 'fuel-stations', singular: 'fuel station', plural: 'fuel stations', title: 'Fuel stations' },
  supermarkets: { slug: 'supermarkets', singular: 'supermarket', plural: 'supermarkets', title: 'Supermarkets' },
  fast_food: { slug: 'fast-food', singular: 'fast food place', plural: 'fast food places', title: 'Fast food' },
  bakerys_cafes: { slug: 'bakeries-cafes', singular: 'bakery or café', plural: 'bakeries and cafés', title: 'Bakeries & cafés' },
  kiosks: { slug: 'kiosks', singular: 'kiosk', plural: 'kiosks', title: 'Kiosks' },
  vending_snacks: { slug: 'vending-machines', singular: 'vending machine', plural: 'snack and drink vending machines', title: 'Vending machines' },
  shelters: { slug: 'shelters', singular: 'shelter', plural: 'shelters', title: 'Shelters' },
  accommodation: { slug: 'accommodation', singular: 'accommodation', plural: 'campsites and accommodation', title: 'Accommodation' }
};

// English display names + URL slugs per manifest country key.
const COUNTRY_META = {
  al: ['Albania', 'albania'], austria: ['Austria', 'austria'], belgium: ['Belgium', 'belgium'],
  bosnia_herzegovina: ['Bosnia and Herzegovina', 'bosnia-and-herzegovina'], bulgaria: ['Bulgaria', 'bulgaria'],
  croatia: ['Croatia', 'croatia'], czechia: ['Czechia', 'czechia'], denmark: ['Denmark', 'denmark'],
  finland: ['Finland', 'finland'], france: ['France', 'france'], germany: ['Germany', 'germany'],
  gr: ['Greece', 'greece'], great_britain: ['Great Britain', 'great-britain'], hungary: ['Hungary', 'hungary'],
  ireland: ['Ireland', 'ireland'], italy: ['Italy', 'italy'], kosovo: ['Kosovo', 'kosovo'],
  luxembourg: ['Luxembourg', 'luxembourg'], macedonia: ['North Macedonia', 'north-macedonia'],
  me: ['Montenegro', 'montenegro'], netherlands: ['Netherlands', 'netherlands'], norway: ['Norway', 'norway'],
  poland: ['Poland', 'poland'], portugal: ['Portugal', 'portugal'], romania: ['Romania', 'romania'],
  serbia: ['Serbia', 'serbia'], slovenia: ['Slovenia', 'slovenia'], slowakei: ['Slovakia', 'slovakia'],
  spain: ['Spain', 'spain'], sweden: ['Sweden', 'sweden'], switzerland: ['Switzerland', 'switzerland'],
  tr: ['Turkey', 'turkey'], kg: ['Kyrgyzstan', 'kyrgyzstan']
};

const OPEN_24_7 = /24\s*\/\s*7|00:00\s*-\s*24:00/i;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value) {
  return String(value).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function countryMeta(key, label) {
  const [name, slug] = COUNTRY_META[key] || [label || key, slugify(label || key)];
  return { key, name, slug };
}

function categoryMeta(id, label) {
  return CATEGORY_META[id] || { slug: slugify(id), singular: label, plural: label, title: label };
}

function gitDate(relPath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', relPath], { cwd: ROOT, encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function readFeatures(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(data?.features) ? data.features : [];
  } catch {
    return [];
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function deepLink(categoryId, region) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const lat = ((minLat + maxLat) / 2).toFixed(4);
  const lng = ((minLon + maxLon) / 2).toFixed(4);
  return `index.html?c=${encodeURIComponent(categoryId)}&a=${lat}&o=${lng}&z=${DEEP_LINK_ZOOM}`;
}

function layout({ title, description, canonicalPath, depth, body, jsonLd }) {
  const up = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${SITE_URL}${canonicalPath}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="nightrides.cc" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${SITE_URL}${canonicalPath}" />
  <meta property="og:image" content="${SITE_URL}assets/icons/munchies-maps-icon-1024.png" />
  <meta name="theme-color" content="#070b2b" />
  <link rel="icon" href="${up}assets/icons/favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="${up}assets/icons/apple-touch-icon.png" />
  <link rel="stylesheet" href="${up}map/seo.css" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<header class="top"><a href="${up}index.html" class="brand">Munchies Maps</a><span>Night-friendly stops for long rides</span></header>
<main>
${body}
</main>
<footer>
  <p>Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL).
  Data can be incomplete or outdated – please double-check before you rely on it, especially at night.</p>
  <p><a href="${up}map/">All countries &amp; categories</a> · <a href="${up}legal/imprint.html">Imprint</a> · <a href="${up}legal/privacy.html">Privacy</a></p>
</footer>
</body>
</html>
`;
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], index) => ({ '@type': 'ListItem', position: index + 1, name, item: url }))
  };
}

const CSS = `:root{--bg:#f6f7fb;--panel:#fff;--text:#111827;--muted:#4b5563;--border:rgba(0,0,0,.12);--accent:#3730a3;--hero:#070b2b}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--panel:#111827;--text:#e5e7eb;--muted:#9ca3af;--border:rgba(255,255,255,.14);--accent:#a5b4fc}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
a{color:var(--accent)}.top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:14px 16px;background:var(--hero);color:#e5e7eb}
.top .brand{color:#fff;font-weight:700;text-decoration:none;font-size:1.1rem}.top span{opacity:.8;font-size:.9rem}
main{max-width:860px;margin:0 auto;padding:24px 16px 32px}h1{font-size:1.75rem;line-height:1.25;margin:8px 0 12px}h2{font-size:1.2rem;margin:28px 0 8px}
.lead{font-size:1.05rem}.stats{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.stat{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:10px 14px;min-width:140px}
.stat b{display:block;font-size:1.4rem}.stat span{color:var(--muted);font-size:.85rem}
.cta{display:inline-block;margin:8px 0 4px;padding:10px 16px;border-radius:10px;background:var(--hero);color:#fff;text-decoration:none;font-weight:600}
.cta:hover,.cta:focus{filter:brightness(1.2)}table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)}td.num,th.num{text-align:right}
ul.links{columns:2;padding-left:18px}@media (max-width:560px){ul.links{columns:1}}.muted{color:var(--muted);font-size:.9rem}
footer{max-width:860px;margin:0 auto;padding:16px 16px 40px;color:var(--muted);font-size:.85rem}
`;

async function main() {
  const manifest = JSON.parse(await readFile(path.join(GEOJSON_DIR, 'manifest.json'), 'utf8'));
  const categories = manifest.categories.map((c) => ({ id: c.id, label: c.label, ...categoryMeta(c.id, c.label) }));

  // country key -> { meta, regions: [...] }
  const countries = new Map();
  for (const region of manifest.regions) {
    if (!region?.country || !region?.path || !Array.isArray(region.bbox)) continue;
    if (!countries.has(region.country)) {
      countries.set(region.country, { meta: countryMeta(region.country, region.country_label), regions: [] });
    }
    countries.get(region.country).regions.push(region);
  }

  // Count POIs: stats[countryKey][categoryId] = { total, open247, regions: [{ region, count }] }
  const stats = {};
  for (const [countryKey, { regions }] of countries) {
    stats[countryKey] = {};
    for (const category of categories) {
      const entry = { total: 0, open247: 0, regions: [] };
      for (const region of regions) {
        const features = await readFeatures(path.join(GEOJSON_DIR, region.path, `${category.id}.geojson`));
        const open247 = features.filter((f) => OPEN_24_7.test(String(f?.properties?.opening_hours || ''))).length;
        entry.total += features.length;
        entry.open247 += open247;
        entry.regions.push({ region, count: features.length });
      }
      entry.regions.sort((a, b) => b.count - a.count || a.region.label.localeCompare(b.region.label));
      stats[countryKey][category.id] = entry;
    }
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'seo.css'), CSS);

  const sortedCountries = [...countries.values()].sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  const pages = []; // { path, lastmod }
  const hasPage = (countryKey, categoryId) => stats[countryKey][categoryId].total >= MIN_POIS_FOR_PAGE;

  for (const { meta: country, regions } of sortedCountries) {
    const dataDate = gitDate(path.posix.join('resources/geojson', regions[0].path.split('/')[0])) || null;
    for (const category of categories) {
      if (!hasPage(country.key, category.id)) continue;
      const entry = stats[country.key][category.id];
      const pagePath = `map/${category.slug}/${country.slug}/`;
      const top = entry.regions[0];
      const mapHref = `../../../${deepLink(category.id, top.region)}`;
      const title = `${category.title} in ${country.name} – map for cyclists | Munchies Maps`;
      const description = `${formatNumber(entry.total)} ${entry.total === 1 ? category.singular : category.plural} in ${country.name} on one map – for night rides, brevets, bikepacking and touring. Filter by opening hours and along your GPX route.`;
      const otherCategories = categories.filter((c) => c.id !== category.id && hasPage(country.key, c.id));
      const otherCountries = sortedCountries.filter((c) => c.meta.key !== country.key && hasPage(c.meta.key, category.id));
      const regionRows = entry.regions.filter((r) => r.count > 0).map((r) =>
        `      <tr><td><a href="../../../${deepLink(category.id, r.region)}">${escapeHtml(r.region.label)}</a></td><td class="num">${formatNumber(r.count)}</td></tr>`
      ).join('\n');

      const body = `  <p class="muted"><a href="../../">All countries</a> › ${escapeHtml(category.title)} › ${escapeHtml(country.name)}</p>
  <h1>${escapeHtml(category.title)} in ${escapeHtml(country.name)} for cyclists</h1>
  <p class="lead">Find ${escapeHtml(category.plural)} in ${escapeHtml(country.name)} for night rides, long-distance rides, brevets and bikepacking.
  Munchies Maps shows them together with other night-friendly stops, highlights places that are open late or 24/7, and filters stops along your imported GPX route.</p>
  <div class="stats">
    <div class="stat"><b>${formatNumber(entry.total)}</b><span>${escapeHtml(category.plural)}</span></div>
    ${entry.open247 > 0 ? `<div class="stat"><b>${formatNumber(entry.open247)}</b><span>tagged as open 24/7</span></div>` : ''}
    <div class="stat"><b>${formatNumber(entry.regions.filter((r) => r.count > 0).length)}</b><span>regions covered</span></div>
  </div>
  <a class="cta" href="${mapHref}">Open the map (${escapeHtml(top.region.label)})</a>
  <p class="muted">${dataDate ? `Data as of ${dataDate}. ` : ''}Source: OpenStreetMap. Opening hours and access can change – always double-check before you rely on a stop.</p>

  <h2>${escapeHtml(category.title)} by region</h2>
  <table>
    <thead><tr><th>Region</th><th class="num">${escapeHtml(category.title)}</th></tr></thead>
    <tbody>
${regionRows}
    </tbody>
  </table>
${otherCategories.length ? `
  <h2>More stops in ${escapeHtml(country.name)}</h2>
  <ul class="links">
${otherCategories.map((c) => `    <li><a href="../../${c.slug}/${country.slug}/">${escapeHtml(c.title)} in ${escapeHtml(country.name)}</a></li>`).join('\n')}
  </ul>` : ''}
${otherCountries.length ? `
  <h2>${escapeHtml(category.title)} in other countries</h2>
  <ul class="links">
${otherCountries.map((c) => `    <li><a href="../${c.meta.slug}/">${escapeHtml(category.title)} in ${escapeHtml(c.meta.name)}</a></li>`).join('\n')}
  </ul>` : ''}`;

      const jsonLd = [
        {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          description,
          url: `${SITE_URL}${pagePath}`,
          isPartOf: { '@type': 'WebApplication', name: 'Munchies Maps', url: SITE_URL }
        },
        breadcrumbLd([
          ['Munchies Maps', SITE_URL],
          ['All countries', `${SITE_URL}map/`],
          [`${category.title} in ${country.name}`, `${SITE_URL}${pagePath}`]
        ])
      ];

      const html = layout({ title, description, canonicalPath: pagePath, depth: 3, body, jsonLd });
      await mkdir(path.join(ROOT, pagePath), { recursive: true });
      await writeFile(path.join(ROOT, pagePath, 'index.html'), html);
      pages.push({ path: pagePath, lastmod: dataDate });
    }
  }

  // Overview page.
  const overviewRows = sortedCountries.map(({ meta: country }) => {
    const links = categories.filter((c) => hasPage(country.key, c.id))
      .map((c) => `<a href="${c.slug}/${country.slug}/">${escapeHtml(c.title)}</a>`).join(' · ');
    return links ? `    <tr><th scope="row">${escapeHtml(country.name)}</th><td>${links}</td></tr>` : '';
  }).filter(Boolean).join('\n');
  const overviewBody = `  <h1>Night-friendly stops for cyclists in Europe</h1>
  <p class="lead">Munchies Maps collects drinking water, public toilets, fuel stations, supermarkets, bakeries, fast food, vending machines and shelters
  from OpenStreetMap in ${sortedCountries.length} countries – made for night rides, brevets, ultra-distance racing and bikepacking.</p>
  <a class="cta" href="../index.html">Open the map</a>
  <h2>Browse by country and category</h2>
  <table>
    <tbody>
${overviewRows}
    </tbody>
  </table>`;
  await writeFile(path.join(OUT_DIR, 'index.html'), layout({
    title: 'Cycling map of night-friendly stops in Europe by country | Munchies Maps',
    description: `Drinking water, toilets, fuel stations, food and shelters for cyclists in ${sortedCountries.length} European countries – browse by country and category.`,
    canonicalPath: 'map/',
    depth: 1,
    body: overviewBody,
    jsonLd: breadcrumbLd([['Munchies Maps', SITE_URL], ['All countries', `${SITE_URL}map/`]])
  }));

  // Sitemap.
  const lastmods = pages.map((p) => p.lastmod).filter(Boolean).sort();
  const newest = lastmods[lastmods.length - 1] || null;
  const urlEntry = (loc, lastmod) => `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`;
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlEntry(SITE_URL, gitDate('index.html')),
    urlEntry(`${SITE_URL}map/`, newest),
    ...pages.map((p) => urlEntry(`${SITE_URL}${p.path}`, p.lastmod)),
    '</urlset>',
    ''
  ].join('\n');
  await writeFile(path.join(ROOT, 'sitemap.xml'), sitemap);

  console.log(`Generated ${pages.length} landing pages, map/index.html and sitemap.xml.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
