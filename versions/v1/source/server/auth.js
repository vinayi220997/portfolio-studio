import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { db, kvGet, kvSet, audit } from './db.js';
import {
  hashPassword, verifyPassword, safeEqual, randomToken, sha256, newId,
  passwordProblems, signTicket, readTicket,
} from './security.js';
import { sendMail, emailReady } from './mailer.js';

const COOKIE = config.isProd ? '__Host-ps_session' : 'ps_session';

// ---------- bootstrap ----------
export async function ensureBootstrapAdmin() {
  const { rows } = await db().query('SELECT count(*)::int AS n FROM admins');
  if (rows[0].n > 0) return { created: false };
  if (!config.bootstrapId || !config.bootstrapPassword) {
    console.warn('[auth] No admin exists and ADMIN_BOOTSTRAP_ID / ADMIN_BOOTSTRAP_PASSWORD are not set. Admin sign-in is disabled until they are.');
    return { created: false, missingEnv: true };
  }
  await db().query(
    'INSERT INTO admins (username, pass_hash, uses_default, must_change) VALUES ($1, $2, TRUE, FALSE)',
    [config.bootstrapId, hashPassword(config.bootstrapPassword)]
  );
  await audit('system', 'admin.bootstrap', { username: config.bootstrapId });
  return { created: true };
}

// ---------- sessions ----------
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token, maxAgeSec) {
  const attrs = [
    `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`,
  ];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

async function createSession(res, adminId) {
  const token = randomToken();
  const hours = config.sessionHours;
  await db().query(
    `INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [sha256(token), adminId, String(hours)]
  );
  setSessionCookie(res, token, hours * 3600);
}

export async function loadSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const { rows } = await db().query(
    `SELECT a.id, a.username, a.uses_default, a.must_change
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  return rows[0] || null;
}

// Protects every admin API route. Also blocks cross-site writes: state-changing
// requests must carry our custom header (browsers can't add it cross-origin
// without a CORS preflight, which we never grant) and a same-origin Origin.
export function requireAdmin({ allowMustChange = false } = {}) {
  return async (req, res, next) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (req.get('X-Requested-With') !== 'portfolio-admin') return res.status(403).json({ error: 'Request blocked.' });
        const origin = req.get('Origin');
        if (origin && !sameOrigin(req, origin)) return res.status(403).json({ error: 'Request blocked.' });
      }
      const admin = await loadSession(req);
      if (!admin) return res.status(401).json({ error: 'Sign in to continue.' });
      if (admin.must_change && !allowMustChange) {
        return res.status(403).json({ error: 'Set a new password to continue.', code: 'MUST_CHANGE_PASSWORD' });
      }
      req.admin = admin;
      next();
    } catch (e) {
      next(e);
    }
  };
}

function sameOrigin(req, origin) {
  try {
    const o = new URL(origin);
    const host = req.get('X-Forwarded-Host') || req.get('Host');
    return o.host === host;
  } catch {
    return false;
  }
}

function guardWrite(req, res, next) {
  if (req.get('X-Requested-With') !== 'portfolio-admin') return res.status(403).json({ error: 'Request blocked.' });
  const origin = req.get('Origin');
  if (origin && !sameOrigin(req, origin)) return res.status(403).json({ error: 'Request blocked.' });
  next();
}

// ---------- rate limits ----------
const testMode = process.env.NODE_ENV === 'test';
const limiter = (max, windowMin, message) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: testMode ? 1000 : max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
  });

const loginLimiter = limiter(10, 15, 'Too many sign-in attempts. Wait 15 minutes and try again.');
const codeLimiter = limiter(5, 15, 'Too many code attempts. Wait 15 minutes and try again.');
const recoveryLimiter = limiter(5, 60, 'Too many recovery requests. Try again in an hour.');

// ---------- routes ----------
export const authRouter = express.Router();
authRouter.use(express.json({ limit: '20kb' }));

// What the login screen may show. Default credentials appear only until the
// first successful sign-in has ever happened, then never again.
authRouter.get('/login-info', async (req, res) => {
  const firstLoginDone = await kvGet('first_login_done', false);
  const { rows } = await db().query('SELECT count(*)::int AS n FROM admins');
  const info = {
    hints: { id: config.hintId, password: config.hintPassword },
    adminReady: rows[0].n > 0,
    recoveryAvailable: Boolean(config.defaultCode || config.recoveryCode || (await kvGet('recovery_code_hash'))),
    firstLogin: !firstLoginDone,
  };
  if (!firstLoginDone && config.showFirstLoginCredentials && rows[0].n > 0 && config.bootstrapId) {
    info.defaultCredentials = { id: config.bootstrapId, password: config.bootstrapPassword };
  }
  res.set('Cache-Control', 'no-store').json(info);
});

authRouter.post('/login', loginLimiter, guardWrite, async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const fail = () => res.status(401).json({ error: 'That admin ID or password is incorrect.' });
    if (!username || !password) return fail();

    const { rows } = await db().query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = rows[0];
    if (!admin) {
      verifyPassword(password, 'scrypt$32768$AAAA$AAAA'); // even out timing
      return fail();
    }

    let ok = verifyPassword(password, admin.pass_hash);
    let viaDefaultCode = false;
    if (!ok && config.bootstrapPassword && safeEqual(password, config.bootstrapPassword)) {
      // One-time sign-in with the default password, unlocked by the default code.
      const unlock = await kvGet('default_unlock');
      if (unlock && !unlock.used && Date.now() < unlock.until) {
        ok = true;
        viaDefaultCode = true;
        await kvSet('default_unlock', { ...unlock, used: true, usedAt: Date.now() });
      }
    }
    if (!ok) {
      await audit(username, 'auth.login_failed');
      return fail();
    }

    if (viaDefaultCode) {
      await db().query('UPDATE admins SET must_change = TRUE WHERE id = $1', [admin.id]);
    }
    await db().query('UPDATE admins SET last_login_at = now() WHERE id = $1', [admin.id]);
    await kvSet('first_login_done', true);
    await createSession(res, admin.id);
    await audit(username, viaDefaultCode ? 'auth.login_default_code' : 'auth.login');
    res.json({ ok: true, mustChange: viaDefaultCode || admin.must_change });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', guardWrite, async (req, res) => {
  const token = parseCookies(req)[COOKIE];
  if (token) await db().query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const admin = await loadSession(req);
  if (!admin) return res.status(401).json({ error: 'Sign in to continue.' });
  res.set('Cache-Control', 'no-store').json({
    username: admin.username,
    usesDefaultPassword: admin.uses_default,
    mustChange: admin.must_change,
  });
});

authRouter.post('/change-password', requireAdmin({ allowMustChange: true }), async (req, res, next) => {
  try {
    const { current, next: nextPw } = req.body || {};
    const { rows } = await db().query('SELECT * FROM admins WHERE id = $1', [req.admin.id]);
    const admin = rows[0];
    // After a default-code sign-in the old password is unknown, so the current
    // password check is skipped only in that forced-change state.
    if (!admin.must_change && !verifyPassword(current, admin.pass_hash)) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    const problems = passwordProblems(nextPw, { username: admin.username });
    if (problems.length) return res.status(400).json({ error: problems.join(' ') });
    await db().query(
      'UPDATE admins SET pass_hash = $1, uses_default = FALSE, must_change = FALSE, updated_at = now() WHERE id = $2',
      [hashPassword(nextPw), admin.id]
    );
    // Sign out every other session.
    const token = parseCookies(req)[COOKIE];
    await db().query('DELETE FROM sessions WHERE admin_id = $1 AND token_hash <> $2', [admin.id, sha256(token)]);
    await audit(admin.username, 'auth.password_changed');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Step 1 of recovery: the "#code" prompt. The response never echoes or hints
// at any code value.
authRouter.post('/verify-code', codeLimiter, guardWrite, async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim();
    const wrong = () => res.status(400).json({ error: "That verification code isn't valid. Check it and try again." });
    if (!code) return wrong();

    if (config.defaultCode && safeEqual(code, config.defaultCode)) {
      await kvSet('default_unlock', { until: Date.now() + 15 * 60 * 1000, used: false });
      await audit('anonymous', 'auth.default_code_accepted');
      return res.json({
        result: 'default',
        message: 'Code accepted. You can sign in once with the default password in the next 15 minutes, then you will set a new password.',
      });
    }

    const storedHash = await kvGet('recovery_code_hash');
    const recoveryOk = storedHash
      ? verifyPassword(code, storedHash)
      : Boolean(config.recoveryCode) && safeEqual(code, config.recoveryCode);
    if (recoveryOk) {
      await audit('anonymous', 'auth.recovery_code_accepted');
      return res.json({ result: 'recovery', ticket: signTicket({ purpose: 'recovery' }, 10 * 60) });
    }

    await audit('anonymous', 'auth.code_rejected');
    return wrong();
  } catch (e) {
    next(e);
  }
});

// Step 2 of recovery: queue a request. A reset link goes only to the recovery
// e-mail saved in the admin (never to an address typed on this form).
authRouter.post('/recovery-request', recoveryLimiter, guardWrite, async (req, res, next) => {
  try {
    if (!readTicket(req.body?.ticket, 'recovery')) {
      return res.status(400).json({ error: 'Your verification has expired. Enter the verification code again.' });
    }
    const username = String(req.body?.username || '').trim().slice(0, 100);
    if (!username) return res.status(400).json({ error: 'Enter your admin ID.' });
    const id = newId('rr_');
    let note = 'queued';
    const { rows } = await db().query('SELECT id FROM admins WHERE username = $1', [username]);
    const recoveryEmail = await kvGet('recovery_email');
    if (rows[0] && recoveryEmail && (await emailReady())) {
      const token = randomToken();
      await db().query(
        `INSERT INTO reset_tokens (token_hash, admin_id, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`,
        [sha256(token), rows[0].id]
      );
      const link = `${config.publicUrl}/admin/#reset=${encodeURIComponent(token)}`;
      try {
        await sendMail({
          to: recoveryEmail,
          subject: 'Reset your portfolio admin password',
          text: `A password reset was requested for the portfolio admin.\n\nOpen this link within 30 minutes to set a new password:\n${link}\n\nIf you didn't request this, ignore this e-mail. Your password stays the same.`,
        });
        note = 'reset link e-mailed';
      } catch (err) {
        note = 'e-mail failed: ' + (err.friendly || err.message);
      }
    }
    await db().query('INSERT INTO recovery_requests (id, username, note) VALUES ($1, $2, $3)', [id, username, note]);
    await audit('anonymous', 'auth.recovery_queued', { requestId: id });
    // Same answer whether or not the account exists.
    res.json({
      ok: true,
      message: 'Recovery request queued. If a recovery e-mail is set up for this admin, a reset link is on its way. Otherwise, follow the operator steps in the README.',
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/reset-password', recoveryLimiter, guardWrite, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const { rows } = await db().query(
      `SELECT t.admin_id, a.username FROM reset_tokens t JOIN admins a ON a.id = t.admin_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
      [sha256(token)]
    );
    if (!rows[0]) return res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' });
    const problems = passwordProblems(req.body?.password, { username: rows[0].username });
    if (problems.length) return res.status(400).json({ error: problems.join(' ') });
    await db().tx(async (q) => {
      await q('UPDATE reset_tokens SET used_at = now() WHERE token_hash = $1', [sha256(token)]);
      await q('UPDATE admins SET pass_hash = $1, uses_default = FALSE, must_change = FALSE, updated_at = now() WHERE id = $2', [
        hashPassword(req.body.password),
        rows[0].admin_id,
      ]);
      await q('DELETE FROM sessions WHERE admin_id = $1', [rows[0].admin_id]);
    });
    await audit(rows[0].username, 'auth.password_reset');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
