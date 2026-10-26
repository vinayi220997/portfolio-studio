import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { db, kvGet, kvSet, audit } from './db.js';
import { requireAdmin } from './auth.js';
import { hashPassword, newId, passwordProblems } from './security.js';
import {
  validateProfile, validateTheme, DEFAULT_THEME, REPEATABLE, referencedFiles, isEmail, seedProfile,
} from './content.js';
import {
  getEmailConfig, saveEmailConfig, clearAppPassword, verifyConnection, sendMail,
} from './mailer.js';

export const adminRouter = express.Router();
adminRouter.use(express.json({ limit: '30mb' }));
adminRouter.use(requireAdmin());
adminRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const who = (req) => req.admin.username;

// ---------- overview ----------
adminRouter.get('/overview', wrap(async (req, res) => {
  const [profiles, msgs, unread, recovery] = await Promise.all([
    db().query('SELECT id, name, status, updated_at FROM profiles ORDER BY position, created_at'),
    db().query('SELECT count(*)::int AS n FROM messages'),
    db().query(`SELECT count(*)::int AS n FROM messages WHERE status = 'new'`),
    db().query(`SELECT count(*)::int AS n FROM recovery_requests WHERE status = 'queued'`),
  ]);
  res.json({
    profiles: profiles.rows,
    messages: msgs.rows[0].n,
    unread: unread.rows[0].n,
    queuedRecoveryRequests: recovery.rows[0].n,
    email: await getEmailConfig(),
    usesDefaultPassword: req.admin.uses_default,
  });
}));

// ---------- profiles ----------
async function getProfile(id) {
  const { rows } = await db().query('SELECT * FROM profiles WHERE id = $1', [id]);
  return rows[0] || null;
}

adminRouter.get('/profiles', wrap(async (req, res) => {
  const { rows } = await db().query('SELECT id, name, status, position, created_at, updated_at FROM profiles ORDER BY position, created_at');
  res.json(rows);
}));

adminRouter.get('/profiles/:id', wrap(async (req, res) => {
  const p = await getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile not found.' });
  res.json(p);
}));

adminRouter.post('/profiles', wrap(async (req, res) => {
  const blank = req.body?.from === 'seed' ? seedProfile() : validateProfile({ displayName: str(req.body?.name) || 'New profile' }).profile;
  const name = str(req.body?.name) || blank.displayName;
  const id = newId('pf_');
  const { rows } = await db().query('SELECT coalesce(max(position), 0) + 1 AS pos FROM profiles');
  await db().query('INSERT INTO profiles (id, name, status, data, position) VALUES ($1, $2, $3, $4::jsonb, $5)', [
    id, name, 'draft', JSON.stringify(blank), rows[0].pos,
  ]);
  await audit(who(req), 'profile.create', { id, name });
  res.status(201).json(await getProfile(id));
}));

adminRouter.put('/profiles/:id', wrap(async (req, res) => {
  const existing = await getProfile(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profile not found.' });
  const { profile, errors } = validateProfile(req.body?.data);
  if (errors.length) return res.status(400).json({ error: 'Fix these before saving.', details: errors });
  const name = str(req.body?.name, 80) || existing.name;
  await db().query('UPDATE profiles SET name = $1, data = $2::jsonb, updated_at = now() WHERE id = $3', [
    name, JSON.stringify(profile), existing.id,
  ]);
  await audit(who(req), 'profile.update', { id: existing.id });
  res.json(await getProfile(existing.id));
}));

adminRouter.post('/profiles/:id/duplicate', wrap(async (req, res) => {
  const src = await getProfile(req.params.id);
  if (!src) return res.status(404).json({ error: 'Profile not found.' });
  const data = structuredClone(src.data);
  for (const key of REPEATABLE) for (const c of data[key] || []) c.id = newId(c.id.split('_')[0] + '_');
  const id = newId('pf_');
  const { rows } = await db().query('SELECT coalesce(max(position), 0) + 1 AS pos FROM profiles');
  await db().query('INSERT INTO profiles (id, name, status, data, position) VALUES ($1, $2, $3, $4::jsonb, $5)', [
    id, `${src.name} (copy)`, 'draft', JSON.stringify(data), rows[0].pos,
  ]);
  await audit(who(req), 'profile.duplicate', { from: src.id, id });
  res.status(201).json(await getProfile(id));
}));

// Publishing: only one profile can be live. Replacing the live one needs confirm=true.
adminRouter.post('/profiles/:id/publish', wrap(async (req, res) => {
  const p = await getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile not found.' });
  const { errors } = validateProfile(p.data);
  if (errors.length) return res.status(400).json({ error: 'Fix these before publishing.', details: errors });
  const { rows: live } = await db().query(`SELECT id, name FROM profiles WHERE status = 'published' AND id <> $1`, [p.id]);
  if (live.length && req.body?.confirm !== true) {
    return res.status(409).json({ error: 'confirm', current: live[0], message: `"${live[0].name}" is live now. Publishing "${p.name}" will replace it and move it to drafts.` });
  }
  await db().tx(async (q) => {
    await q(`UPDATE profiles SET status = 'draft', updated_at = now() WHERE status = 'published' AND id <> $1`, [p.id]);
    await q(`UPDATE profiles SET status = 'published', updated_at = now() WHERE id = $1`, [p.id]);
  });
  await audit(who(req), 'profile.publish', { id: p.id, replaced: live[0]?.id || null });
  res.json({ ok: true, replaced: live[0] || null });
}));

adminRouter.post('/profiles/:id/status', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['draft', 'hidden'].includes(status)) return res.status(400).json({ error: 'Status must be draft or hidden.' });
  const p = await getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile not found.' });
  await db().query('UPDATE profiles SET status = $1, updated_at = now() WHERE id = $2', [status, p.id]);
  await audit(who(req), `profile.${status === 'hidden' ? 'hide' : 'unpublish'}`, { id: p.id });
  res.json({ ok: true });
}));

adminRouter.delete('/profiles/:id', wrap(async (req, res) => {
  const p = await getProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile not found.' });
  if (req.body?.confirmName !== p.name) return res.status(400).json({ error: `Type the profile name "${p.name}" to confirm deletion.` });
  await db().query('DELETE FROM profiles WHERE id = $1', [p.id]);
  await purgeOrphanFiles();
  await audit(who(req), 'profile.delete', { id: p.id, name: p.name });
  res.json({ ok: true });
}));

// ---------- uploads ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

adminRouter.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Files can be up to ${config.maxUploadMb} MB.` : 'Upload failed.' });
      if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
      const mime = sniff(req.file.buffer);
      const kind = req.query.kind === 'resume' ? 'resume' : 'image';
      const allowed = kind === 'resume' ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp'];
      if (!mime || !allowed.includes(mime)) {
        return res.status(400).json({ error: kind === 'resume' ? 'Resumes must be PDF files.' : 'Images must be JPG, PNG or WebP.' });
      }
      const id = newId('f_');
      const name = String(req.file.originalname || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      await db().query('INSERT INTO files (id, name, mime, size, bytes) VALUES ($1, $2, $3, $4, $5)', [
        id, name, mime, req.file.size, req.file.buffer,
      ]);
      await audit(who(req), 'file.upload', { id, mime, size: req.file.size });
      res.status(201).json({ id, name, mime, size: req.file.size, url: `/files/${id}` });
    } catch (e) {
      next(e);
    }
  });
});

async function purgeOrphanFiles() {
  const { rows } = await db().query('SELECT data FROM profiles');
  const keep = new Set(rows.flatMap((r) => referencedFiles(r.data)));
  const { rows: files } = await db().query(`SELECT id FROM files WHERE created_at < now() - interval '1 hour'`);
  for (const f of files) if (!keep.has(f.id)) await db().query('DELETE FROM files WHERE id = $1', [f.id]);
}

// ---------- theme ----------
adminRouter.get('/theme', wrap(async (req, res) => {
  res.json({ theme: validateTheme(await kvGet('theme', DEFAULT_THEME)), defaults: DEFAULT_THEME });
}));

adminRouter.put('/theme', wrap(async (req, res) => {
  const theme = validateTheme(req.body);
  await kvSet('theme', theme);
  await audit(who(req), 'theme.update', theme);
  res.json({ theme });
}));

// ---------- e-mail ----------
adminRouter.get('/email', wrap(async (req, res) => res.json(await getEmailConfig())));

adminRouter.put('/email', wrap(async (req, res) => {
  const { gmailAddress, appPassword, fromName, notifyOnContact } = req.body || {};
  if (!isEmail(gmailAddress)) return res.status(400).json({ error: 'Enter the Gmail address the App Password belongs to.' });
  if (appPassword && String(appPassword).replace(/\s+/g, '').length !== 16) {
    return res.status(400).json({ error: 'Google App Passwords are 16 letters. Copy it again from your Google Account.' });
  }
  await saveEmailConfig({ gmailAddress, appPassword, fromName, notifyOnContact });
  await audit(who(req), 'email.config_saved', { gmailAddress, appPasswordChanged: Boolean(appPassword) });
  res.json(await getEmailConfig());
}));

adminRouter.delete('/email/app-password', wrap(async (req, res) => {
  await clearAppPassword();
  await audit(who(req), 'email.app_password_removed');
  res.json(await getEmailConfig());
}));

adminRouter.post('/email/test', wrap(async (req, res) => {
  const check = await verifyConnection();
  if (!check.ok) return res.status(502).json({ error: check.error, check });
  const to = req.body?.sendTo;
  if (to) {
    if (!isEmail(to)) return res.status(400).json({ error: 'Enter a valid address for the test e-mail.' });
    try {
      await sendMail({ to, subject: 'Portfolio e-mail test', text: 'Your portfolio can send e-mail through Gmail. No action needed.' });
    } catch (e) {
      return res.status(502).json({ error: e.friendly, check });
    }
  }
  res.json({ ok: true, check, sent: Boolean(to) });
}));

// ---------- messages (contact inbox) ----------
adminRouter.get('/messages', wrap(async (req, res) => {
  const status = req.query.status;
  const where = ['new', 'read', 'replied', 'archived'].includes(status) ? `WHERE status = '${status}'` : `WHERE status <> 'archived'`;
  const { rows } = await db().query(
    `SELECT m.id, m.name, m.email, m.subject, left(m.body, 160) AS preview, m.status, m.created_at,
            (SELECT count(*)::int FROM replies r WHERE r.message_id = m.id) AS replies
       FROM messages m ${where} ORDER BY m.created_at DESC LIMIT 500`
  );
  res.json(rows);
}));

adminRouter.get('/messages/export', wrap(async (req, res) => {
  const format = req.query.format === 'json' ? 'json' : 'csv';
  const emailsOnly = req.query.scope === 'emails';
  const { rows } = await db().query('SELECT id, name, email, subject, body, status, created_at FROM messages ORDER BY created_at DESC');
  const stamp = new Date().toISOString().slice(0, 10);
  let out;
  if (emailsOnly) {
    const seen = new Map();
    for (const r of rows) if (!seen.has(r.email.toLowerCase())) seen.set(r.email.toLowerCase(), { name: r.name, email: r.email });
    out = [...seen.values()];
  } else {
    out = rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  }
  await audit(who(req), 'messages.export', { format, scope: emailsOnly ? 'emails' : 'all', count: out.length });
  const base = `contacts-${emailsOnly ? 'emails' : 'all'}-${stamp}`;
  if (format === 'json') {
    res.set('Content-Disposition', `attachment; filename="${base}.json"`).json(out);
  } else {
    const cols = out.length ? Object.keys(out[0]) : emailsOnly ? ['name', 'email'] : ['id', 'name', 'email', 'subject', 'body', 'status', 'created_at'];
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // block spreadsheet formula injection
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...out.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${base}.csv"`).send('﻿' + csv);
  }
}));

adminRouter.get('/messages/:id', wrap(async (req, res) => {
  const { rows } = await db().query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Message not found.' });
  if (rows[0].status === 'new') {
    await db().query(`UPDATE messages SET status = 'read' WHERE id = $1`, [rows[0].id]);
    rows[0].status = 'read';
  }
  const { rows: replies } = await db().query('SELECT * FROM replies WHERE message_id = $1 ORDER BY sent_at', [rows[0].id]);
  res.json({ ...rows[0], replies });
}));

adminRouter.patch('/messages/:id', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['new', 'read', 'replied', 'archived'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  await db().query('UPDATE messages SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ ok: true });
}));

adminRouter.delete('/messages/:id', wrap(async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm deletion first.' });
  await db().query('DELETE FROM messages WHERE id = $1', [req.params.id]);
  await audit(who(req), 'message.delete', { id: req.params.id });
  res.json({ ok: true });
}));

adminRouter.post('/messages/:id/reply', wrap(async (req, res) => {
  const { rows } = await db().query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
  const m = rows[0];
  if (!m) return res.status(404).json({ error: 'Message not found.' });
  const body = str(req.body?.body, 20000);
  if (!body) return res.status(400).json({ error: 'Write a reply first.' });
  const subject = str(req.body?.subject, 200) || (m.subject ? (m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`) : 'Re: your message');
  const quoted = `\n\n— On ${new Date(m.created_at).toUTCString()}, ${m.name} wrote:\n` + m.body.split('\n').map((l) => '> ' + l).join('\n');
  const id = newId('r_');
  try {
    await sendMail({ to: m.email, subject, text: body + quoted });
    await db().query(`INSERT INTO replies (id, message_id, body, status) VALUES ($1, $2, $3, 'sent')`, [id, m.id, body]);
    await db().query(`UPDATE messages SET status = 'replied' WHERE id = $1`, [m.id]);
    await audit(who(req), 'message.reply', { id: m.id });
    res.json({ ok: true });
  } catch (e) {
    await db().query(`INSERT INTO replies (id, message_id, body, status, error) VALUES ($1, $2, $3, 'failed', $4)`, [id, m.id, body, e.friendly]);
    res.status(502).json({ error: e.friendly });
  }
}));

// ---------- backup & restore ----------
const BACKUP_FORMAT = 'portfolio-studio-backup';

adminRouter.get('/backup', wrap(async (req, res) => {
  const includeFiles = req.query.files !== 'false';
  const { rows: profiles } = await db().query('SELECT id, name, status, data, position, created_at, updated_at FROM profiles ORDER BY position');
  let files = [];
  if (includeFiles) {
    const ids = [...new Set(profiles.flatMap((p) => referencedFiles(p.data)))];
    if (ids.length) {
      const { rows } = await db().query('SELECT id, name, mime, size, bytes FROM files WHERE id = ANY($1)', [ids]);
      files = rows.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, base64: Buffer.from(f.bytes).toString('base64') }));
    }
  }
  const emailCfg = (await kvGet('email_config')) || {};
  const backup = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    // Deliberately excluded: admin accounts, password hashes, sessions,
    // verification codes, the Gmail App Password and the audit log.
    theme: validateTheme(await kvGet('theme', DEFAULT_THEME)),
    settings: { emailDisplay: { gmailAddress: emailCfg.gmailAddress || '', fromName: emailCfg.fromName || '', notifyOnContact: emailCfg.notifyOnContact !== false } },
    profiles,
    files,
  };
  await audit(who(req), 'backup.download', { profiles: profiles.length, files: files.length });
  res.set('Content-Disposition', `attachment; filename="portfolio-backup-${backup.exportedAt.slice(0, 10)}.json"`).json(backup);
}));

function checkBackup(b) {
  const problems = [];
  if (!b || b.format !== BACKUP_FORMAT) problems.push("This isn't a portfolio backup file.");
  else {
    if (b.version !== 1) problems.push(`Backup version ${b.version} isn't supported by this site.`);
    if (!Array.isArray(b.profiles) || !b.profiles.length) problems.push('The backup has no profiles.');
    const published = (b.profiles || []).filter((p) => p.status === 'published');
    if (published.length > 1) problems.push('The backup has more than one published profile.');
    for (const [i, p] of (b.profiles || []).entries()) {
      const { errors } = validateProfile(p.data);
      if (errors.length) problems.push(`Profile ${i + 1} ("${p.name}"): ${errors[0]}`);
    }
    for (const f of b.files || []) {
      if (!/^f_[A-Za-z0-9_-]{6,40}$/.test(f.id) || !f.base64) problems.push(`File "${f.name}" is damaged.`);
    }
    const secretKeys = JSON.stringify(b).match(/"(pass_hash|appPassword|app_password|recovery_code_hash)"/);
    if (secretKeys) problems.push('The backup contains credential fields. Use a backup downloaded from this admin.');
  }
  return problems;
}

adminRouter.post('/restore/validate', wrap(async (req, res) => {
  const b = req.body;
  const problems = checkBackup(b);
  res.json({
    ok: problems.length === 0,
    problems,
    summary: problems.length ? null : {
      exportedAt: b.exportedAt,
      profiles: b.profiles.map((p) => ({ name: p.name, status: p.status })),
      files: (b.files || []).length,
      theme: Boolean(b.theme),
    },
  });
}));

adminRouter.post('/restore', wrap(async (req, res) => {
  const { backup, confirm } = req.body || {};
  if (confirm !== true) return res.status(400).json({ error: 'Confirm the restore first.' });
  const problems = checkBackup(backup);
  if (problems.length) return res.status(400).json({ error: 'The backup can’t be restored.', details: problems });
  await db().tx(async (q) => {
    await q('DELETE FROM profiles');
    for (const [i, p] of backup.profiles.entries()) {
      const { profile } = validateProfile(p.data);
      await q('INSERT INTO profiles (id, name, status, data, position) VALUES ($1, $2, $3, $4::jsonb, $5)', [
        /^pf_[A-Za-z0-9_-]{6,40}$/.test(p.id) ? p.id : newId('pf_'),
        str(p.name, 80) || profile.displayName,
        ['draft', 'published', 'hidden'].includes(p.status) ? p.status : 'draft',
        JSON.stringify(profile),
        i + 1,
      ]);
    }
    for (const f of backup.files || []) {
      const bytes = Buffer.from(f.base64, 'base64');
      const mime = sniff(bytes);
      if (!mime) continue;
      await q(
        `INSERT INTO files (id, name, mime, size, bytes) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [f.id, str(f.name, 120) || 'file', mime, bytes.length, bytes]
      );
    }
    if (backup.theme) await kvSet('theme', validateTheme(backup.theme), q);
  });
  await audit(who(req), 'backup.restore', { profiles: backup.profiles.length, files: (backup.files || []).length });
  res.json({ ok: true });
}));

// ---------- security ----------
adminRouter.get('/security', wrap(async (req, res) => {
  const { rows } = await db().query(`SELECT id, username, status, note, created_at FROM recovery_requests ORDER BY created_at DESC LIMIT 50`);
  res.json({
    username: req.admin.username,
    usesDefaultPassword: req.admin.uses_default,
    recoveryEmail: (await kvGet('recovery_email')) || '',
    customRecoveryCode: Boolean(await kvGet('recovery_code_hash')),
    envRecoveryCode: Boolean(config.recoveryCode),
    envDefaultCode: Boolean(config.defaultCode),
    recoveryRequests: rows,
  });
}));

adminRouter.put('/security/recovery-email', wrap(async (req, res) => {
  const email = str(req.body?.email, 200);
  if (email && !isEmail(email)) return res.status(400).json({ error: 'Enter a valid recovery e-mail.' });
  await kvSet('recovery_email', email);
  await audit(who(req), 'security.recovery_email', { set: Boolean(email) });
  res.json({ ok: true });
}));

adminRouter.put('/security/recovery-code', wrap(async (req, res) => {
  const code = String(req.body?.code || '');
  if (!code) {
    await db().query(`DELETE FROM kv WHERE key = 'recovery_code_hash'`);
    await audit(who(req), 'security.recovery_code_cleared');
    return res.json({ ok: true });
  }
  if (code.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for the recovery code.' });
  if (config.defaultCode && code === config.defaultCode) return res.status(400).json({ error: 'The recovery code must differ from the default code.' });
  await kvSet('recovery_code_hash', hashPassword(code));
  await audit(who(req), 'security.recovery_code_set');
  res.json({ ok: true });
}));

adminRouter.patch('/security/recovery-requests/:id', wrap(async (req, res) => {
  await db().query(`UPDATE recovery_requests SET status = 'closed' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

adminRouter.get('/audit', wrap(async (req, res) => {
  const { rows } = await db().query('SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 200');
  res.json(rows);
}));

function str(v, max = 200) {
  return v === undefined || v === null ? '' : String(v).trim().slice(0, max);
}

export { passwordProblems };
