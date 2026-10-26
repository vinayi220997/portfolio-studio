// Runtime configuration. Every secret comes from the environment (Render
// dashboard in production, a local .env in development). Nothing secret is
// ever sent to the browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader for local development (no dependency needed).
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  isProd: env.NODE_ENV === 'production',
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: path.join(ROOT, '.data', 'pglite'),
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),

  // Bootstrap admin (used to create the first admin account on first start).
  bootstrapId: env.ADMIN_BOOTSTRAP_ID || '',
  bootstrapPassword: env.ADMIN_BOOTSTRAP_PASSWORD || '',
  showFirstLoginCredentials: (env.SHOW_FIRST_LOGIN_CREDENTIALS || 'true') === 'true',

  // Login-page hints (always shown). They are hints, never credentials.
  hintId: env.ADMIN_HINT_ID || 'role_context',
  hintPassword: env.ADMIN_HINT_PASSWORD || 'role_context@length',

  // Verification codes for the recovery flow. Never sent to the browser.
  defaultCode: env.ADMIN_DEFAULT_CODE || '',
  recoveryCode: env.ADMIN_RECOVERY_CODE || '',

  // Encrypts stored secrets (Gmail App Password). 32+ random characters.
  encryptionKey: env.DATA_ENCRYPTION_KEY || '',
  sessionSecret: env.SESSION_SECRET || env.DATA_ENCRYPTION_KEY || '',

  sessionHours: Number(env.SESSION_HOURS || 12),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 8),
};

export function assertProductionConfig() {
  const missing = [];
  if (config.isProd) {
    if (!config.databaseUrl) missing.push('DATABASE_URL');
    if (!config.encryptionKey || config.encryptionKey.length < 32) missing.push('DATA_ENCRYPTION_KEY (32+ chars)');
  }
  return missing;
}
