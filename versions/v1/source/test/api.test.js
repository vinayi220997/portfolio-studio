// End-to-end API tests against an in-memory Postgres (PGlite).
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ADMIN_BOOTSTRAP_ID = 'admin_context';
process.env.ADMIN_BOOTSTRAP_PASSWORD = 'Default-pass-58';
process.env.ADMIN_DEFAULT_CODE = 'DEFAULT-CODE-1';
process.env.ADMIN_RECOVERY_CODE = 'RECOVERY-CODE-2';
process.env.DATA_ENCRYPTION_KEY = 'x'.repeat(40);

const { createApp } = await import('../server/index.js');

let server, base;
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'portfolio-admin' };

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = H) {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) this.cookie = c.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
}

before(async () => {
  const app = await createApp({ memoryDb: true });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const admin = new Client();
let currentPassword = 'Default-pass-58';

test('login screen shows hints and first-login credentials only before the first sign-in', async () => {
  const c = new Client();
  const before = await c.req('GET', '/api/auth/login-info');
  assert.deepEqual(before.json.hints, { id: 'role_context', password: 'role_context@length' });
  assert.equal(before.json.defaultCredentials.id, 'admin_context');

  const bad = await c.req('POST', '/api/auth/login', { username: 'admin_context', password: 'nope' });
  assert.equal(bad.status, 401);
  // A failed attempt doesn't count as the first sign-in.
  assert.ok((await c.req('GET', '/api/auth/login-info')).json.defaultCredentials);

  const ok = await admin.req('POST', '/api/auth/login', { username: 'admin_context', password: currentPassword });
  assert.equal(ok.status, 200);
  const afterInfo = await c.req('GET', '/api/auth/login-info');
  assert.equal(afterInfo.json.defaultCredentials, undefined);
  assert.equal(afterInfo.json.hints.id, 'role_context');
});

test('session cookie is HttpOnly and SameSite=Strict', async () => {
  const c = new Client();
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin_context', password: currentPassword }) });
  const cookie = r.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('default password keeps working until changed, and the dashboard flags it', async () => {
  const me = await admin.req('GET', '/api/auth/me');
  assert.equal(me.json.usesDefaultPassword, true);
  const c = new Client();
  assert.equal((await c.req('POST', '/api/auth/login', { username: 'admin_context', password: currentPassword })).status, 200);
});

test('protected routes reject anonymous and cross-site requests', async () => {
  const anon = new Client();
  assert.equal((await anon.req('GET', '/api/admin/profiles')).status, 401);
  const noHeader = await admin.req('POST', '/api/admin/profiles', { name: 'x' }, { 'Content-Type': 'application/json' });
  assert.equal(noHeader.status, 403);
  const crossOrigin = await admin.req('POST', '/api/admin/profiles', { name: 'x' }, { ...H, Origin: 'https://evil.example' });
  assert.equal(crossOrigin.status, 403);
});

test('wrong verification code is rejected without revealing any code', async () => {
  const c = new Client();
  const r = await c.req('POST', '/api/auth/verify-code', { code: 'WRONG' });
  assert.equal(r.status, 400);
  assert.ok(!r.text.includes('DEFAULT-CODE-1') && !r.text.includes('RECOVERY-CODE-2'));
  const info = await c.req('GET', '/api/auth/login-info');
  assert.ok(!info.text.includes('CODE'));
});

test('recovery code opens the queue-recovery-request step', async () => {
  const c = new Client();
  const v = await c.req('POST', '/api/auth/verify-code', { code: 'RECOVERY-CODE-2' });
  assert.equal(v.json.result, 'recovery');
  assert.ok(v.json.ticket);
  const noTicket = await c.req('POST', '/api/auth/recovery-request', { username: 'admin_context', ticket: 'forged.ticket' });
  assert.equal(noTicket.status, 400);
  const q = await c.req('POST', '/api/auth/recovery-request', { username: 'admin_context', ticket: v.json.ticket });
  assert.equal(q.status, 200);
  const unknown = await c.req('POST', '/api/auth/recovery-request', { username: 'nobody', ticket: v.json.ticket });
  assert.equal(unknown.json.message, q.json.message); // no account enumeration
});

test('changing the password rejects weak ones and turns off the default flag', async () => {
  const weak = await admin.req('POST', '/api/auth/change-password', { current: currentPassword, next: 'short' });
  assert.equal(weak.status, 400);
  const same = await admin.req('POST', '/api/auth/change-password', { current: currentPassword, next: 'Default-pass-58' });
  assert.equal(same.status, 400);
  const wrongCurrent = await admin.req('POST', '/api/auth/change-password', { current: 'bad', next: 'Brand-new-pass-77' });
  assert.equal(wrongCurrent.status, 400);
  const ok = await admin.req('POST', '/api/auth/change-password', { current: currentPassword, next: 'Brand-new-pass-77' });
  assert.equal(ok.status, 200);
  currentPassword = 'Brand-new-pass-77';
  assert.equal((await admin.req('GET', '/api/auth/me')).json.usesDefaultPassword, false);
  const c = new Client();
  assert.equal((await c.req('POST', '/api/auth/login', { username: 'admin_context', password: 'Default-pass-58' })).status, 401);
});

test('default code allows exactly one sign-in with the default password, then forces a new password', async () => {
  const c = new Client();
  const v = await c.req('POST', '/api/auth/verify-code', { code: 'DEFAULT-CODE-1' });
  assert.equal(v.json.result, 'default');
  const login = await c.req('POST', '/api/auth/login', { username: 'admin_context', password: 'Default-pass-58' });
  assert.equal(login.status, 200);
  assert.equal(login.json.mustChange, true);
  // Everything except changing the password is blocked.
  const blocked = await c.req('GET', '/api/admin/profiles');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'MUST_CHANGE_PASSWORD');
  // The unlock is single-use.
  const again = await new Client().req('POST', '/api/auth/login', { username: 'admin_context', password: 'Default-pass-58' });
  assert.equal(again.status, 401);
  const set = await c.req('POST', '/api/auth/change-password', { next: 'Recovered-pass-99' });
  assert.equal(set.status, 200);
  currentPassword = 'Recovered-pass-99';
  assert.equal((await c.req('GET', '/api/admin/profiles')).status, 200);
  // Other sessions were signed out by the password change.
  assert.equal((await admin.req('GET', '/api/admin/profiles')).status, 401);
  assert.equal((await admin.req('POST', '/api/auth/login', { username: 'admin_context', password: currentPassword })).status, 200);
});

let mainId, copyId;

test('seeded profile is published and public view hides private data', async () => {
  const list = (await admin.req('GET', '/api/admin/profiles')).json;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'published');
  mainId = list[0].id;
  const site = (await new Client().req('GET', '/api/public/site')).json;
  assert.equal(site.profile.displayName, 'Ramathota Vinay');
  assert.equal(site.profile.phones.length, 0); // seeded phone is hidden
  assert.ok(!JSON.stringify(site).includes('9966782923'));
});

test('editing validates input and unpublished cards stay off the public site', async () => {
  const p = (await admin.req('GET', `/api/admin/profiles/${mainId}`)).json;
  const bad = structuredClone(p.data);
  bad.emails.push({ label: 'Bad', address: 'not-an-email' });
  const r = await admin.req('PUT', `/api/admin/profiles/${mainId}`, { data: bad });
  assert.equal(r.status, 400);
  assert.ok(r.json.details[0].includes('not-an-email'));

  const data = structuredClone(p.data);
  data.projects[0].published = false;
  data.links.push({ label: 'Evil', url: 'javascript:alert(1)' });
  const r2 = await admin.req('PUT', `/api/admin/profiles/${mainId}`, { data });
  assert.equal(r2.status, 400); // javascript: links are refused

  data.links.pop();
  data.phones[0].visible = true;
  data.emails.push({ label: 'Personal', address: 'second@example.com', primary: true });
  const ok = await admin.req('PUT', `/api/admin/profiles/${mainId}`, { data });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.emails.filter((e) => e.primary).length, 1);
  const site = (await new Client().req('GET', '/api/public/site')).json;
  assert.equal(site.profile.projects.length, 5);
  assert.equal(site.profile.phones.length, 1);
  assert.equal(site.profile.emails.length, 2);
});

test('duplicating a profile creates a draft with fresh card ids', async () => {
  const r = await admin.req('POST', `/api/admin/profiles/${mainId}/duplicate`);
  assert.equal(r.status, 201);
  copyId = r.json.id;
  assert.equal(r.json.status, 'draft');
  const orig = (await admin.req('GET', `/api/admin/profiles/${mainId}`)).json;
  assert.notEqual(r.json.data.projects[0].id, orig.data.projects[0].id);
});

test('only one profile can be published; replacing needs confirmation', async () => {
  const first = await admin.req('POST', `/api/admin/profiles/${copyId}/publish`, {});
  assert.equal(first.status, 409);
  assert.equal(first.json.current.id, mainId);
  const ok = await admin.req('POST', `/api/admin/profiles/${copyId}/publish`, { confirm: true });
  assert.equal(ok.status, 200);
  const list = (await admin.req('GET', '/api/admin/profiles')).json;
  assert.equal(list.filter((p) => p.status === 'published').length, 1);
  assert.equal(list.find((p) => p.id === mainId).status, 'draft');
  // Put the original back.
  await admin.req('POST', `/api/admin/profiles/${mainId}/publish`, { confirm: true });
});

test('hide and delete need explicit confirmation', async () => {
  assert.equal((await admin.req('POST', `/api/admin/profiles/${copyId}/status`, { status: 'hidden' })).status, 200);
  const no = await admin.req('DELETE', `/api/admin/profiles/${copyId}`, { confirmName: 'wrong' });
  assert.equal(no.status, 400);
  const name = (await admin.req('GET', `/api/admin/profiles/${copyId}`)).json.name;
  assert.equal((await admin.req('DELETE', `/api/admin/profiles/${copyId}`, { confirmName: name })).status, 200);
});

test('uploads accept real images/PDFs only', async () => {
  const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8CFC0F01F0005000201E2216BC40000000049454E44AE426082', 'hex');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
  const r = await fetch(base + '/api/admin/upload', { method: 'POST', headers: { 'X-Requested-With': 'portfolio-admin', Cookie: admin.cookie }, body: form });
  assert.equal(r.status, 201);
  const { url } = await r.json();
  const f = await fetch(base + url);
  assert.equal(f.headers.get('content-type'), 'image/png');

  const fake = new FormData();
  fake.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  const r2 = await fetch(base + '/api/admin/upload', { method: 'POST', headers: { 'X-Requested-With': 'portfolio-admin', Cookie: admin.cookie }, body: fake });
  assert.equal(r2.status, 400);
});

test('theme saves, validates and drives the favicon colour', async () => {
  const r = await admin.req('PUT', '/api/admin/theme', { mode: 'dark', accent: '#ff5500', background: { type: 'gradient', gradient: { from: '#000000', to: '#123456', angle: 45 } } });
  assert.equal(r.json.theme.accent, '#FF5500');
  const junk = await admin.req('PUT', '/api/admin/theme', { mode: 'neon', accent: 'red' });
  assert.equal(junk.json.theme.mode, 'system');
  await admin.req('PUT', '/api/admin/theme', { mode: 'system', accent: '#FF5500' });
  const fav = await new Client().req('GET', '/favicon.svg');
  assert.match(fav.text, /#FF5500/);
  assert.match(fav.text, />RV</);
});

test('Gmail App Password is stored encrypted and never returned', async () => {
  const bad = await admin.req('PUT', '/api/admin/email', { gmailAddress: 'me@gmail.com', appPassword: 'short' });
  assert.equal(bad.status, 400);
  const r = await admin.req('PUT', '/api/admin/email', { gmailAddress: 'me@gmail.com', appPassword: 'abcd efgh ijkl mnop', fromName: 'Vinay' });
  assert.equal(r.status, 200);
  assert.equal(r.json.hasAppPassword, true);
  assert.ok(!r.text.includes('abcd'));
  const backup = await admin.req('GET', '/api/admin/backup');
  assert.ok(!backup.text.includes('abcdefghijklmnop'));
  await admin.req('DELETE', '/api/admin/email/app-password');
});

test('contact form saves messages and exports to CSV/JSON', async () => {
  const c = new Client();
  const bad = await c.req('POST', '/api/public/contact', { name: '', email: 'x', message: 'hi' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.email);
  for (const [n, e] of [['Asha', 'asha@example.com'], ['Ravi', 'ravi@example.com'], ['Asha again', 'ASHA@example.com']]) {
    assert.equal((await c.req('POST', '/api/public/contact', { name: n, email: e, subject: 'Hello', message: '=cmd|calc injection test message' })).status, 200);
  }
  const list = (await admin.req('GET', '/api/admin/messages')).json;
  assert.equal(list.length, 3);
  const csv = await admin.req('GET', '/api/admin/messages/export?format=csv&scope=all');
  assert.match(csv.headers.get('content-disposition'), /\.csv/);
  assert.ok(csv.text.includes("'=cmd")); // formula injection neutralised
  const emails = (await admin.req('GET', '/api/admin/messages/export?format=json&scope=emails')).json;
  assert.equal(emails.length, 2); // de-duplicated case-insensitively
  const reply = await admin.req('POST', `/api/admin/messages/${list[0].id}/reply`, { body: 'Thanks!' });
  assert.equal(reply.status, 502); // e-mail not configured → clear error
  assert.match(reply.json.error, /not set up/i);
});

test('backup excludes secrets; restore validates and needs confirmation', async () => {
  const b = (await admin.req('GET', '/api/admin/backup')).json;
  assert.equal(b.format, 'portfolio-studio-backup');
  const s = JSON.stringify(b);
  for (const secret of ['pass_hash', 'scrypt$', 'RECOVERY-CODE-2', 'DEFAULT-CODE-1', 'Recovered-pass-99']) assert.ok(!s.includes(secret), secret);
  assert.ok(b.files.length >= 0);

  const v = (await admin.req('POST', '/api/admin/restore/validate', { format: 'nope' })).json;
  assert.equal(v.ok, false);
  const good = (await admin.req('POST', '/api/admin/restore/validate', b)).json;
  assert.equal(good.ok, true);

  b.profiles[0].data.displayName = 'Restored Name';
  assert.equal((await admin.req('POST', '/api/admin/restore', { backup: b })).status, 400);
  assert.equal((await admin.req('POST', '/api/admin/restore', { backup: b, confirm: true })).status, 200);
  const site = (await new Client().req('GET', '/api/public/site')).json;
  assert.equal(site.profile.displayName, 'Restored Name');
  // Admin login still works after restore (accounts untouched).
  assert.equal((await new Client().req('POST', '/api/auth/login', { username: 'admin_context', password: currentPassword })).status, 200);
});

test('security headers are present and errors are generic', async () => {
  const r = await fetch(base + '/');
  assert.ok(r.headers.get('content-security-policy'));
  assert.equal(r.headers.get('x-powered-by'), null);
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: H, body: '{broken' });
  assert.equal(bad.status, 400);
});

test('logout ends the session', async () => {
  await admin.req('POST', '/api/auth/logout', {});
  assert.equal((await admin.req('GET', '/api/admin/profiles')).status, 401);
});
