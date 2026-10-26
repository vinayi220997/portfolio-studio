import express from 'express';
import rateLimit from 'express-rate-limit';
import { db, kvGet, audit } from './db.js';
import { publicView, validateTheme, DEFAULT_THEME, isEmail, seedProfile } from './content.js';
import { newId } from './security.js';
import { sendMail, getEmailConfig } from './mailer.js';

export const publicRouter = express.Router();

export async function publishedProfile() {
  const { rows } = await db().query(`SELECT id, name, data, updated_at FROM profiles WHERE status = 'published' LIMIT 1`);
  return rows[0] || null;
}

export async function ensureSeedProfile() {
  const { rows } = await db().query('SELECT count(*)::int AS n FROM profiles');
  if (rows[0].n > 0) return;
  const data = seedProfile();
  await db().query(
    `INSERT INTO profiles (id, name, status, data, position) VALUES ($1, $2, 'published', $3::jsonb, 1)`,
    [newId('pf_'), 'Main profile', JSON.stringify(data)]
  );
}

publicRouter.get('/site', async (req, res, next) => {
  try {
    const p = await publishedProfile();
    const theme = validateTheme(await kvGet('theme', DEFAULT_THEME));
    res.set('Cache-Control', 'no-cache');
    if (!p) return res.json({ profile: null, theme });
    res.json({ profile: publicView(p.data), theme, updatedAt: p.updated_at });
  } catch (e) {
    next(e);
  }
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: "You've sent several messages already. Try again in an hour." },
});

publicRouter.post('/contact', contactLimiter, express.json({ limit: '20kb' }), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot: quietly drop bots
    const name = String(b.name || '').trim().slice(0, 120);
    const email = String(b.email || '').trim().slice(0, 200);
    const subject = String(b.subject || '').trim().slice(0, 200);
    const message = String(b.message || '').trim().slice(0, 5000);
    const errors = {};
    if (!name) errors.name = 'Enter your name.';
    if (!isEmail(email)) errors.email = 'Enter an e-mail address I can reply to.';
    if (message.length < 10) errors.message = 'Write a few more words (at least 10 characters).';
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Check the highlighted fields.', fields: errors });

    const id = newId('m_');
    await db().query('INSERT INTO messages (id, name, email, subject, body) VALUES ($1, $2, $3, $4, $5)', [
      id, name, email, subject, message,
    ]);
    await audit('visitor', 'message.received', { id });

    // Best-effort notification to the owner; the message is already saved.
    const cfg = await getEmailConfig();
    if (cfg.notifyOnContact && cfg.gmailAddress && cfg.hasAppPassword) {
      sendMail({
        to: cfg.gmailAddress,
        replyTo: `"${name.replace(/"/g, '')}" <${email}>`,
        subject: `New portfolio message: ${subject || name}`,
        text: `${name} <${email}> wrote:\n\n${message}\n\nReply from the admin inbox or directly to this e-mail.`,
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
