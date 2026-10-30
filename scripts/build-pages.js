// Builds the GitHub Pages copy of the public site into dist-pages/.
//
//   LIVE_API_URL=https://<your-service>.onrender.com npm run build:pages
//
// Optional: PAGES_BASE (default /portfolio-studio-site/), SNAPSHOT_FROM_LOCAL=1
// to take the bundled snapshot from the local database instead of the live site.
//
// The built page loads published content from LIVE_API_URL on every visit, so
// admin edits appear without rebuilding. snapshot.json is only shown while the
// live server is waking up or unreachable. Rebuild only for code/design changes.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

const LIVE = String(process.env.LIVE_API_URL || '').replace(/\/$/, '');
const BASE = (process.env.PAGES_BASE || '/portfolio-studio-site/').replace(/\/?$/, '/');
const OUT = path.join(ROOT, 'dist-pages');
const PUB = path.join(ROOT, 'public');

if (!/^https?:\/\/[^/]+$/.test(LIVE)) {
  console.error('Set LIVE_API_URL to your Render address, e.g. LIVE_API_URL=https://portfolio-studio.onrender.com');
  process.exit(1);
}

// ---------- 1. snapshot of what's published now ----------
async function fromLive() {
  const site = await (await fetch(`${LIVE}/api/public/site`, { signal: AbortSignal.timeout(90000) })).json();
  const favicon = await (await fetch(`${LIVE}/favicon.svg`)).text();
  return { site, favicon };
}

async function fromLocal() {
  const { createApp } = await import('../server/index.js');
  const app = await createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const site = await (await fetch(`${base}/api/public/site`)).json();
    const favicon = await (await fetch(`${base}/favicon.svg`)).text();
    return { site, favicon };
  } finally {
    server.close();
  }
}

let snap;
if (process.env.SNAPSHOT_FROM_LOCAL === '1') snap = await fromLocal();
else {
  try {
    console.log(`Reading published content from ${LIVE} (may take a minute if it is asleep)…`);
    snap = await fromLive();
  } catch (e) {
    console.warn(`Couldn't reach ${LIVE} (${e.message}). Using the local database for the snapshot.`);
    snap = await fromLocal();
  }
}

// ---------- 2. copy and rewrite files ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const abs = (s) =>
  s
    .replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}`)
    .replace(/url\('\/(?!\/)/g, `url('${BASE}`)
    .replace(/from '\/shared\//g, `from '${BASE}shared/`);

for (const dir of ['shared', 'fonts', 'assets']) {
  fs.cpSync(path.join(PUB, dir), path.join(OUT, dir), { recursive: true });
}
for (const f of ['shared/tokens.css']) {
  const p = path.join(OUT, f);
  fs.writeFileSync(p, abs(fs.readFileSync(p, 'utf8')));
}
fs.writeFileSync(path.join(OUT, 'site.css'), abs(fs.readFileSync(path.join(PUB, 'site.css'), 'utf8')));
fs.writeFileSync(path.join(OUT, 'site.js'), abs(fs.readFileSync(path.join(PUB, 'site.js'), 'utf8')));

const cfg = { api: LIVE, snapshot: `${BASE}snapshot.json`, base: BASE };
fs.writeFileSync(path.join(OUT, 'config.js'), `window.PORTFOLIO_CONFIG = ${JSON.stringify(cfg)};\n`);

let html = abs(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'));
html = html
  .replace(`href="${BASE}favicon.svg"`, `href="${BASE}favicon.svg"`)
  .replace(`<script src="${BASE}shared/theme-boot.js"></script>`, `<script src="${BASE}config.js"></script>\n  <script src="${BASE}shared/theme-boot.js"></script>`);
// Pre-fill title and description so link previews look right before JS runs.
const p = snap.site.profile;
if (p) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const title = p.displayName + (p.titles ? ' — ' + p.titles.split(',')[0].trim() : '');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  if (p.intro) html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.intro)}">`);
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '404.html'), abs(fs.readFileSync(path.join(PUB, '404.html'), 'utf8')).replace(`href="${BASE}"`, `href="${BASE}"`));
fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(snap.site));
fs.writeFileSync(path.join(OUT, 'favicon.svg'), snap.favicon);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(
  path.join(OUT, 'README.md'),
  `# Vinay Ramathota — portfolio (GitHub Pages copy)\n\n## Live links\n\n- Portfolio: https://vinayi220997.github.io${BASE}\n- Same site on Render: ${LIVE}/\n- Source code: https://github.com/vinayi220997/portfolio-studio\n\nBuilt from the \`portfolio-studio\` repo with \`npm run build:pages\`. Don't edit these files by hand.\n\n- Content loads live from ${LIVE} on every visit, so edits in the admin appear here automatically.\n- \`snapshot.json\` (taken ${new Date().toISOString()}) is shown only while the live server is waking up or unreachable.\n- The contact form sends messages to the admin inbox on the live server.\n`
);

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? count(path.join(dir, d.name)) : 1), 0);
console.log(`Built dist-pages/ (${count(OUT)} files) for ${BASE} with live content from ${LIVE}.`);
process.exit(0);
