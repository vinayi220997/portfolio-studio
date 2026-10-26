// Gmail sending via an App Password (SMTP). The App Password is stored
// encrypted in the database and never leaves the server.
import nodemailer from 'nodemailer';
import { db, kvGet, kvSet } from './db.js';
import { encrypt, decrypt } from './security.js';

const SECRET_KEY = 'gmail_app_password';

export async function getEmailConfig() {
  const cfg = (await kvGet('email_config')) || {};
  const { rows } = await db().query('SELECT updated_at FROM secrets WHERE key = $1', [SECRET_KEY]);
  return {
    gmailAddress: cfg.gmailAddress || '',
    fromName: cfg.fromName || '',
    notifyOnContact: cfg.notifyOnContact !== false,
    hasAppPassword: rows.length > 0,
    appPasswordUpdatedAt: rows[0]?.updated_at || null,
    lastCheck: cfg.lastCheck || null,
  };
}

export async function saveEmailConfig({ gmailAddress, fromName, notifyOnContact, appPassword }) {
  const prev = (await kvGet('email_config')) || {};
  await kvSet('email_config', {
    ...prev,
    gmailAddress: String(gmailAddress || '').trim(),
    fromName: String(fromName || '').trim().slice(0, 80),
    notifyOnContact: notifyOnContact !== false,
    lastCheck: null,
  });
  if (appPassword) {
    const clean = String(appPassword).replace(/\s+/g, '');
    await db().query(
      `INSERT INTO secrets (key, ciphertext, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()`,
      [SECRET_KEY, encrypt(clean)]
    );
  }
}

export async function clearAppPassword() {
  await db().query('DELETE FROM secrets WHERE key = $1', [SECRET_KEY]);
}

export async function emailReady() {
  const c = await getEmailConfig();
  return Boolean(c.gmailAddress && c.hasAppPassword);
}

async function transport() {
  const cfg = (await kvGet('email_config')) || {};
  const { rows } = await db().query('SELECT ciphertext FROM secrets WHERE key = $1', [SECRET_KEY]);
  if (!cfg.gmailAddress || !rows[0]) {
    const e = new Error('not configured');
    e.friendly = 'E-mail is not set up yet. Add your Gmail address and App Password in Settings → E-mail.';
    throw e;
  }
  const pass = decrypt(rows[0].ciphertext);
  const t = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: cfg.gmailAddress, pass },
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return { t, cfg };
}

// Turns SMTP failures into messages that say what to do next.
export function friendlyError(err) {
  const code = err?.code || '';
  const msg = String(err?.message || '');
  if (err?.friendly) return err.friendly;
  if (code === 'EAUTH' || /535|Username and Password not accepted/i.test(msg)) {
    return 'Gmail rejected the sign-in. Check the Gmail address, and create a new 16-character App Password (Google Account → Security → App passwords). 2-Step Verification must be on.';
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ENETUNREACH', 'ECONNREFUSED'].includes(code) || /timeout|unreachable/i.test(msg)) {
    return "Couldn't reach Gmail's mail server. Your host may block outbound e-mail ports (Render's free plan does). Move the service to a paid instance, then test again.";
  }
  if (/Invalid recipient|EENVELOPE/i.test(msg) || code === 'EENVELOPE') {
    return 'The recipient address was rejected. Check it and try again.';
  }
  return 'Sending failed: ' + msg.slice(0, 200);
}

export async function verifyConnection() {
  try {
    const { t } = await transport();
    await t.verify();
    const prev = (await kvGet('email_config')) || {};
    const lastCheck = { ok: true, at: new Date().toISOString() };
    await kvSet('email_config', { ...prev, lastCheck });
    return lastCheck;
  } catch (err) {
    const prev = (await kvGet('email_config')) || {};
    const lastCheck = { ok: false, at: new Date().toISOString(), error: friendlyError(err) };
    await kvSet('email_config', { ...prev, lastCheck });
    return lastCheck;
  }
}

export async function sendMail({ to, subject, text, replyTo, inReplyTo, references }) {
  let t, cfg;
  try {
    ({ t, cfg } = await transport());
    const info = await t.sendMail({
      from: cfg.fromName ? `"${cfg.fromName.replace(/"/g, '')}" <${cfg.gmailAddress}>` : cfg.gmailAddress,
      to,
      subject,
      text,
      replyTo,
      inReplyTo,
      references,
    });
    return info;
  } catch (err) {
    err.friendly = friendlyError(err);
    throw err;
  }
}
