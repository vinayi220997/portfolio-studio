import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { config, ROOT, assertProductionConfig } from './config.js';
import { initDb, db, kvGet } from './db.js';
import { authRouter, ensureBootstrapAdmin } from './auth.js';
import { adminRouter } from './admin.js';
import { publicRouter, ensureSeedProfile, publishedProfile } from './public.js';
import { validateTheme, DEFAULT_THEME, initials } from './content.js';

export async function createApp({ memoryDb = false } = {}) {
  const missing = assertProductionConfig();
  if (missing.length) throw new Error('Missing required environment variables: ' + missing.join(', '));

  await initDb({ memory: memoryDb });
  await ensureBootstrapAdmin();
  await ensureSeedProfile();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https:'],
          'frame-src': ["'self'", 'https:'],
          'object-src': ["'none'"],
          'connect-src': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'self'"],
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  app.get('/healthz', async (req, res) => {
    try {
      await db().query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  // The GitHub Pages copy of the site reads published content from here.
  // Only these public routes allow cross-origin use; admin and auth never do,
  // and no cookies are accepted cross-origin.
  app.use('/api/public', publicCors, publicRouter);

  // Uploaded files (profile images, resume PDFs). IDs are random and unguessable.
  app.get('/files/:id', publicCors, async (req, res, next) => {
    try {
      if (!/^f_[A-Za-z0-9_-]{6,40}$/.test(req.params.id)) return res.status(404).end();
      const { rows } = await db().query('SELECT name, mime, bytes FROM files WHERE id = $1', [req.params.id]);
      if (!rows[0]) return res.status(404).end();
      const f = rows[0];
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.set({
        'Content-Type': f.mime,
        'Content-Disposition': `${disposition}; filename="${f.name.replace(/"/g, '')}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        // Lets the GitHub page preview the resume PDF in its dialog.
        'Content-Security-Policy': `frame-ancestors 'self' ${config.publicSiteOrigins.join(' ')}`.trim(),
      });
      res.removeHeader('X-Frame-Options');
      res.send(Buffer.from(f.bytes));
    } catch (e) {
      next(e);
    }
  });

  // Favicon generated from the logo letters and accent colour.
  app.get('/favicon.svg', publicCors, async (req, res, next) => {
    try {
      const p = await publishedProfile();
      const theme = validateTheme(await kvGet('theme', DEFAULT_THEME));
      const letters = (p?.data?.logo?.letters || initials(p?.data?.displayName)).replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'P';
      const shape = p?.data?.logo?.shape || 'rounded';
      const rx = shape === 'circle' ? 32 : shape === 'square' ? 4 : 14;
      const size = letters.length > 2 ? 24 : letters.length > 1 ? 30 : 38;
      res.type('image/svg+xml').set({ 'Cache-Control': 'no-cache', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${rx}" fill="${theme.accent}"/><text x="32" y="33" dominant-baseline="middle" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${size}" fill="#fff">${letters}</text></svg>`
      );
    } catch (e) {
      next(e);
    }
  });

  const pub = path.join(ROOT, 'public');
  app.use('/admin', express.static(path.join(pub, 'admin'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
  app.use(express.static(pub, { index: false, maxAge: config.isProd ? '1h' : 0 }));
  app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

  // Never leak stack traces or internals to the browser.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
    console.error('[error]', err?.message || err);
    res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
  });

  return app;
}

// CORS for the read-only public routes and the contact form, limited to the
// origins listed in PUBLIC_SITE_ORIGINS (e.g. https://vinayi220997.github.io).
function publicCors(req, res, next) {
  const origin = req.get('Origin');
  if (origin && config.publicSiteOrigins.includes(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
    res.append('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.status(204).end();
  } else if (req.method === 'OPTIONS') {
    return res.status(403).end();
  }
  next();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'server/index.js');
if (isMain) {
  createApp()
    .then((app) => {
      app.listen(config.port, () => console.log(`Portfolio running on ${config.publicUrl} (db: ${db().kind})`));
    })
    .catch((e) => {
      console.error('Failed to start:', e.message);
      process.exit(1);
    });
}
