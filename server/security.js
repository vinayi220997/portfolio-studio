import crypto from 'node:crypto';
import { config } from './config.js';

// ---------- password hashing (scrypt, no native deps) ----------
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, n, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const key = Buffer.from(keyB64, 'base64');
    const test = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), key.length, {
      ...SCRYPT,
      N: Number(n),
    });
    return crypto.timingSafeEqual(key, test);
  } catch {
    return false;
  }
}

// Constant-time comparison for codes held in environment variables.
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a).length === String(b).length;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

// ---------- password policy ----------
export function passwordProblems(pw, { username } = {}) {
  const p = String(pw || '');
  const problems = [];
  if (p.length < 10) problems.push('Use at least 10 characters.');
  if (!/[a-z]/i.test(p) || !/[0-9]/.test(p)) problems.push('Mix letters and numbers.');
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) problems.push("Don't include the admin ID.");
  if (config.bootstrapPassword && p === config.bootstrapPassword) problems.push('Choose a password different from the default one.');
  return problems;
}

// ---------- encryption for stored secrets (AES-256-GCM) ----------
function encKey() {
  if (!config.encryptionKey) {
    if (config.isProd) throw new Error('DATA_ENCRYPTION_KEY is not set');
    return crypto.createHash('sha256').update('local-development-only-key').digest();
  }
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(blob) {
  const [v, ivB, tagB, dataB] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB, 'base64'));
  d.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dataB, 'base64')), d.final()]).toString('utf8');
}

// ---------- short-lived signed tickets (recovery flow step 2) ----------
function hmacKey() {
  return crypto.createHash('sha256').update('ticket:' + (config.sessionSecret || 'local-dev')).digest();
}

export function signTicket(payload, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', hmacKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readTicket(ticket, purpose) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', hmacKey()).update(body).digest('base64url');
  if (expect.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.purpose !== purpose || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}
