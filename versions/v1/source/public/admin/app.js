import { h, icon, btn, iconBtn, api, toast, confirmDialog, errorText, fmtDate, download, field, toggle, events } from './ui.js';
import { profileEditor, label } from './profile-editor.js';
import { applyTheme, contrast, onAccent } from '/shared/theme.js';

const app = document.getElementById('app');
let me = null;
let dirty = false;
let siteTheme = null;
let siteLogo = null;

// ---------- boot ----------
events.addEventListener('signed-out', () => { me = null; showLogin('Your session ended. Sign in again.'); });
events.addEventListener('must-change', () => showMustChange());
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

async function boot() {
  try {
    const t = await (await fetch('/api/public/site')).json();
    siteTheme = t.theme;
    if (t.profile?.logo) siteLogo = t.profile.logo;
    applyTheme(siteTheme, { overrideMode: adminMode() });
  } catch { /* keep cached theme */ }

  const reset = location.hash.match(/^#reset=(.+)$/);
  if (reset) return showReset(decodeURIComponent(reset[1]));
  try {
    me = await api('/api/auth/me');
  } catch {
    return showLogin();
  }
  if (me.mustChange) return showMustChange();
  showShell();
}

function adminMode() {
  try { return localStorage.getItem('ps-admin-mode'); } catch { return null; }
}

// ---------- login & recovery ----------
async function showLogin(notice) {
  let info = { hints: {} };
  try { info = await api('/api/auth/login-info'); } catch { /* server down: still show form */ }
  const err = h('p', { class: 'form-error', role: 'alert', hidden: !notice, text: notice || '' });
  const user = h('input', { class: 'input', id: 'login-id', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false' });
  const pass = h('input', { class: 'input', id: 'login-pw', type: 'password', autocomplete: 'current-password', required: true });
  const show = iconBtn('eye', 'Show password', () => {
    const vis = pass.type === 'password';
    pass.type = vis ? 'text' : 'password';
    show.replaceChildren(icon(vis ? 'eyeOff' : 'eye'));
    show.setAttribute('aria-label', vis ? 'Hide password' : 'Show password');
  });
  const submit = btn('Sign in', { kind: 'primary', type: 'submit' });
  const form = h('form', { class: 'auth-form', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'login-id', text: 'Admin ID' }), user, h('p', { class: 'hint', text: `Hint: ${info.hints.id || ''}` })),
    h('div', { class: 'field' }, h('label', { for: 'login-pw', text: 'Password' }), h('div', { class: 'input-with-btn' }, pass, show), h('p', { class: 'hint', text: `Hint: ${info.hints.password || ''}` })),
    err, submit,
    info.recoveryAvailable ? h('button', { class: 'link-btn', type: 'button', onclick: () => showCodePrompt() }, 'Forgot your password?') : null);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      const out = await api('/api/auth/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value } });
      me = await api('/api/auth/me');
      if (out.mustChange) showMustChange();
      else { location.hash = '#/overview'; showShell(); }
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      pass.select();
    } finally {
      submit.disabled = false;
    }
  });

  const firstLogin = info.defaultCredentials
    ? h('div', { class: 'callout callout-info' },
      h('strong', { text: 'First sign-in' }),
      h('p', { text: 'Use these default credentials once. They won’t be shown again after you sign in, so change the password from the dashboard.' }),
      h('dl', { class: 'creds' }, h('dt', { text: 'Admin ID' }), h('dd', {}, h('code', { text: info.defaultCredentials.id })), h('dt', { text: 'Password' }), h('dd', {}, h('code', { text: info.defaultCredentials.password }))),
      btn('Fill in for me', { small: true, onclick: () => { user.value = info.defaultCredentials.id; pass.value = info.defaultCredentials.password; submit.focus(); } }))
    : null;

  authScreen('Sign in to your portfolio', info.adminReady === false
    ? h('div', { class: 'callout callout-bad' }, h('strong', { text: 'Admin isn’t set up yet.' }), h('p', { text: 'Set ADMIN_BOOTSTRAP_ID and ADMIN_BOOTSTRAP_PASSWORD on the server, restart it, then reload this page.' }))
    : h('div', { class: 'stack' }, firstLogin, form));
  user.focus();
}

function showCodePrompt() {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const code = h('input', { class: 'input', id: 'code', autocomplete: 'one-time-code', spellcheck: 'false', autocapitalize: 'none' });
  const submit = btn('Verify', { kind: 'primary', type: 'submit' });
  const form = h('form', { class: 'auth-form', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'code', class: 'code-label' }, h('span', { class: 'hash', 'aria-hidden': 'true', text: '#' }), 'code'), code, h('p', { class: 'hint', text: 'Enter the verification code.' })),
    err, submit,
    h('button', { class: 'link-btn', type: 'button', onclick: () => showLogin() }, 'Back to sign in'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      const out = await api('/api/auth/verify-code', { method: 'POST', body: { code: code.value } });
      if (out.result === 'default') {
        await showLogin(out.message);
        document.querySelector('.form-error').classList.add('form-ok');
      } else if (out.result === 'recovery') showRecoveryRequest(out.ticket);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      code.select();
    } finally {
      submit.disabled = false;
    }
  });
  authScreen('Verify it’s you', form);
  code.focus();
}

function showRecoveryRequest(ticket) {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const user = h('input', { class: 'input', id: 'rr-id', autocomplete: 'username' });
  const submit = btn('Queue recovery request', { kind: 'primary', type: 'submit' });
  const form = h('form', { class: 'auth-form', novalidate: true },
    h('p', { class: 'muted', text: 'Code accepted. Queue a recovery request and a reset link will go to the recovery e-mail saved in the admin, if one is set.' }),
    field('Admin ID', user), err, submit,
    h('button', { class: 'link-btn', type: 'button', onclick: () => showLogin() }, 'Back to sign in'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const out = await api('/api/auth/recovery-request', { method: 'POST', body: { ticket, username: user.value } });
      authScreen('Request queued', h('div', { class: 'stack' }, h('p', { text: out.message }), btn('Back to sign in', { onclick: () => showLogin() })));
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      submit.disabled = false;
    }
  });
  authScreen('Queue a recovery request', form);
  user.focus();
}

function passwordForm({ needCurrent, onSubmit, submitLabel }) {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const cur = needCurrent ? h('input', { class: 'input', type: 'password', autocomplete: 'current-password' }) : null;
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const again = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const submit = btn(submitLabel, { kind: 'primary', type: 'submit' });
  const form = h('form', { class: 'auth-form', novalidate: true },
    cur ? field('Current password', cur) : null,
    field('New password', next, 'At least 10 characters, with letters and numbers.'),
    field('Repeat new password', again), err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (next.value !== again.value) { err.textContent = 'The new passwords don’t match.'; err.hidden = false; return; }
    submit.disabled = true;
    try {
      await onSubmit({ current: cur?.value, next: next.value });
      form.reset();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

function showMustChange() {
  authScreen('Set a new password', h('div', { class: 'stack' },
    h('p', { class: 'muted', text: 'You signed in with the default password using a verification code. Choose a new password to continue.' }),
    passwordForm({ needCurrent: false, submitLabel: 'Save password and continue', onSubmit: async ({ next }) => {
      await api('/api/auth/change-password', { method: 'POST', body: { next } });
      me = await api('/api/auth/me');
      toast('Password saved.');
      location.hash = '#/overview';
      showShell();
    } })));
}

function showReset(token) {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const submit = btn('Set new password', { kind: 'primary', type: 'submit' });
  const form = h('form', { class: 'auth-form', novalidate: true }, field('New password', pw, 'At least 10 characters, with letters and numbers.'), err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, password: pw.value } });
      history.replaceState(null, '', '/admin/');
      showLogin('Password updated. Sign in with your new password.');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      submit.disabled = false;
    }
  });
  authScreen('Reset your password', form);
}

function authScreen(title, body) {
  dirty = false;
  app.replaceChildren(h('main', { class: 'auth' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, h('span', { class: 'mark', 'data-shape': siteLogo?.shape || 'rounded', text: siteLogo?.letters || 'A' }), h('span', { text: 'Portfolio admin' })),
      h('h1', { text: title }), body),
    h('a', { class: 'auth-site', href: '/' }, icon('left'), 'Back to the website')));
  const m = document.querySelector('.form-error:not([hidden])');
  if (m && /accepted|updated/i.test(m.textContent)) m.classList.add('form-ok');
}

// ---------- shell ----------
const NAV = [
  ['overview', 'Overview', 'home'],
  ['profiles', 'Profiles', 'user'],
  ['inbox', 'Inbox', 'inbox'],
  ['appearance', 'Appearance', 'palette'],
  ['email', 'E-mail', 'mail'],
  ['backup', 'Backup & export', 'archive'],
  ['security', 'Account & security', 'shield'],
];

let shellMain, navEl, noticeEl;

function showShell() {
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Admin navigation' },
    h('div', { class: 'side-top' },
      h('a', { class: 'side-brand', href: '#/overview' }, h('span', { class: 'mark', id: 'side-mark', 'data-shape': siteLogo?.shape || 'rounded', text: siteLogo?.letters || 'A' }), h('span', { text: 'Portfolio admin' })),
      iconBtn('x', 'Close menu', () => document.body.classList.remove('nav-open'))),
    // The middle scrolls on its own so notices never push the sign-out off screen.
    h('div', { class: 'side-scroll' },
      navEl = h('nav', { 'aria-label': 'Sections' }, h('ul', {}, NAV.map(([k, l, i]) => h('li', {}, h('a', { href: `#/${k}`, 'data-k': k }, icon(i), h('span', { text: l }), k === 'inbox' ? h('span', { class: 'count', id: 'unread', hidden: true }) : null))))),
      noticeEl = h('div', { class: 'side-notices' })),
    h('div', { class: 'side-bottom' },
      h('a', { class: 'side-link', href: '/', target: '_blank', rel: 'noopener' }, icon('ext'), h('span', { text: 'View website' })),
      modeSwitch(),
      h('div', { class: 'side-user' }, h('span', { class: 'avatar-dot', 'aria-hidden': 'true', text: (me.username[0] || 'A').toUpperCase() }), h('span', { class: 'who', text: me.username }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: signOut }, icon('logout'), h('span', { text: 'Sign out' })))));
  shellMain = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  app.replaceChildren(
    h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
    h('div', { class: 'shell' },
      h('header', { class: 'mobile-bar' }, iconBtn('menu', 'Open menu', () => document.body.classList.add('nav-open')), h('span', { text: 'Portfolio admin' })),
      sidebar, h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') }), shellMain));
  refreshNotices();
  route();
}

function modeSwitch() {
  const cur = adminMode() || 'site';
  return h('label', { class: 'side-mode' }, h('span', { text: 'Admin theme' }),
    h('select', { class: 'input input-sm', onchange: (e) => {
      const v = e.target.value;
      try { if (v === 'site') localStorage.removeItem('ps-admin-mode'); else localStorage.setItem('ps-admin-mode', v); } catch { /* blocked */ }
      applyTheme(siteTheme, { overrideMode: v === 'site' ? null : v });
    } }, [['site', 'Same as site'], ['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device'], ['browser', 'Browser colours']].map(([v, l]) => h('option', { value: v, text: l, selected: v === cur }))));
}

async function refreshNotices() {
  try {
    const o = await api('/api/admin/overview');
    const unread = document.getElementById('unread');
    if (unread) { unread.hidden = !o.unread; unread.textContent = o.unread; unread.setAttribute('aria-label', `${o.unread} unread`); }
    const notes = [];
    if (o.usesDefaultPassword) notes.push(h('div', { class: 'notice notice-warn', role: 'status' }, icon('warn'), h('div', {}, h('strong', { text: 'The default password is still in use.' }), h('p', { text: 'Anyone who knows it can sign in. Change it now.' }), h('a', { href: '#/security', text: 'Change password' }))));
    if (!o.email.gmailAddress || !o.email.hasAppPassword) notes.push(h('div', { class: 'notice' }, icon('mail'), h('div', {}, h('strong', { text: 'E-mail isn’t set up.' }), h('p', { text: 'Messages are saved, but you can’t reply from here yet.' }), h('a', { href: '#/email', text: 'Set up e-mail' }))));
    if (o.queuedRecoveryRequests) notes.push(h('div', { class: 'notice notice-warn' }, icon('shield'), h('div', {}, h('strong', { text: `${o.queuedRecoveryRequests} recovery request${o.queuedRecoveryRequests > 1 ? 's' : ''}` }), h('p', { text: 'Someone used a recovery code. Review it if it wasn’t you.' }), h('a', { href: '#/security', text: 'Review' }))));
    noticeEl?.replaceChildren(...notes);
    return o;
  } catch { return null; }
}

async function signOut() {
  if (dirty && !(await confirmDialog({ title: 'Sign out without saving?', body: 'Your unsaved profile changes will be lost.', confirmLabel: 'Sign out' }))) return;
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  me = null;
  dirty = false;
  showLogin('You’re signed out.');
}

let lastHash = location.hash;
window.addEventListener('hashchange', async () => {
  if (!me || !shellMain) return;
  if (dirty && !(await confirmDialog({ title: 'Leave without saving?', body: 'You have unsaved changes on this profile.', confirmLabel: 'Leave', danger: true }))) {
    history.replaceState(null, '', lastHash);
    return;
  }
  dirty = false;
  route();
});

function route() {
  lastHash = location.hash;
  const [, k = 'overview', arg] = location.hash.match(/^#\/([a-z]+)(?:\/(.+))?/) || [];
  document.body.classList.remove('nav-open');
  navEl.querySelectorAll('a').forEach((a) => (a.dataset.k === k ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  shellMain.replaceChildren(h('p', { class: 'loading', text: 'Loading…' }));
  const views = { overview, profiles, inbox, appearance, email, backup, security };
  if (k === 'profiles' && arg) profileEditor(shellMain, arg, { onDirty: (d) => { dirty = d; } });
  else (views[k] || overview)(shellMain, arg);
  shellMain.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function page(title, intro, ...body) {
  return [h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), intro ? h('p', { class: 'muted', text: intro }) : null)), ...body];
}

// ---------- Overview ----------
async function overview(root) {
  const o = await refreshNotices();
  if (!o) return root.replaceChildren(h('p', { class: 'empty', text: 'Couldn’t load the overview. Reload the page.' }));
  const pub = o.profiles.find((p) => p.status === 'published');
  root.replaceChildren(...page(`Hello, ${me.username}`, 'Here’s the state of your portfolio.',
    o.usesDefaultPassword ? h('div', { class: 'callout callout-warn' }, h('strong', { text: 'You’re still using the default password.' }), h('p', { text: 'It stays valid until you change it. Change it now so only you can sign in.' }), h('a', { class: 'btn btn-sm', href: '#/security' }, 'Change password')) : null,
    h('div', { class: 'stats' },
      stat('Live profile', pub ? pub.name : 'None published', pub ? `Updated ${fmtDate(pub.updated_at)}` : 'Visitors see an empty page', pub ? `#/profiles/${pub.id}` : '#/profiles'),
      stat('Profiles', String(o.profiles.length), `${o.profiles.filter((p) => p.status === 'draft').length} draft, ${o.profiles.filter((p) => p.status === 'hidden').length} hidden`, '#/profiles'),
      stat('Messages', String(o.messages), o.unread ? `${o.unread} unread` : 'All read', '#/inbox'),
      stat('E-mail', o.email.hasAppPassword && o.email.gmailAddress ? (o.email.lastCheck?.ok ? 'Connected' : o.email.lastCheck ? 'Check failed' : 'Not tested') : 'Not set up', o.email.gmailAddress || 'Add a Gmail App Password', '#/email')),
    h('section', { class: 'card' }, h('h2', { text: 'Quick actions' }),
      h('div', { class: 'row wrap' },
        pub ? h('a', { class: 'btn btn-primary', href: `#/profiles/${pub.id}` }, icon('edit'), 'Edit live profile') : null,
        h('a', { class: 'btn', href: '#/appearance' }, icon('palette'), 'Change theme'),
        h('a', { class: 'btn', href: '#/backup' }, icon('download'), 'Download a backup'),
        h('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, icon('ext'), 'View website')))));
}

function stat(k, v, sub, href) {
  return h('a', { class: 'stat', href }, h('span', { class: 'stat-k', text: k }), h('span', { class: 'stat-v', text: v }), h('span', { class: 'stat-sub', text: sub }));
}

// ---------- Profiles ----------
async function profiles(root) {
  let list;
  try { list = await api('/api/admin/profiles'); } catch (e) { return root.replaceChildren(h('p', { class: 'empty', text: errorText(e) })); }
  const act = async (fn, okMsg) => {
    try { await fn(); if (okMsg) toast(okMsg); profiles(root); refreshNotices(); } catch (e) { toast(errorText(e), 'bad'); }
  };
  const publish = async (p) => {
    try {
      await api(`/api/admin/profiles/${p.id}/publish`, { method: 'POST', body: {} });
      toast(`"${p.name}" is live.`);
    } catch (e) {
      if (e.status !== 409) return toast(errorText(e), 'bad');
      if (!(await confirmDialog({ title: `Publish "${p.name}"?`, body: e.body.message, confirmLabel: 'Publish and replace' }))) return;
      try { await api(`/api/admin/profiles/${p.id}/publish`, { method: 'POST', body: { confirm: true } }); toast(`"${p.name}" is live. "${e.body.current.name}" moved to drafts.`); } catch (e2) { return toast(errorText(e2), 'bad'); }
    }
    profiles(root);
    refreshNotices();
  };
  root.replaceChildren(...page('Profiles', 'Only one profile is live at a time. Use others for drafts or variations, for example one per role you apply for.',
    h('div', { class: 'row' },
      btn('New blank profile', { kind: 'primary', iconName: 'plus', onclick: () => act(async () => { const p = await api('/api/admin/profiles', { method: 'POST', body: { name: 'New profile' } }); location.hash = `#/profiles/${p.id}`; }) }),
      btn('New from resume content', { iconName: 'plus', onclick: () => act(async () => { const p = await api('/api/admin/profiles', { method: 'POST', body: { from: 'seed', name: 'Resume-based profile' } }); location.hash = `#/profiles/${p.id}`; }) })),
    h('ul', { class: 'profile-list' }, list.map((p) => h('li', { class: 'profile-row' + (p.status === 'published' ? ' is-live' : '') },
      h('div', { class: 'grow' },
        h('a', { class: 'profile-name', href: `#/profiles/${p.id}`, text: p.name }),
        h('p', { class: 'hint', text: `Updated ${fmtDate(p.updated_at)}` })),
      h('span', { class: `badge badge-${p.status}`, text: label(p.status) }),
      h('div', { class: 'row-tight wrap' },
        h('a', { class: 'btn btn-sm', href: `#/profiles/${p.id}` }, icon('edit'), 'Edit'),
        p.status !== 'published' ? btn('Publish', { small: true, kind: 'primary', onclick: () => publish(p) }) : null,
        btn('Duplicate', { small: true, iconName: 'copy', onclick: () => act(() => api(`/api/admin/profiles/${p.id}/duplicate`, { method: 'POST', body: {} }), 'Copied as a draft.') }),
        p.status === 'hidden'
          ? btn('Unhide', { small: true, iconName: 'eye', onclick: () => act(() => api(`/api/admin/profiles/${p.id}/status`, { method: 'POST', body: { status: 'draft' } }), 'Moved to drafts.') })
          : btn(p.status === 'published' ? 'Unpublish' : 'Hide', { small: true, iconName: 'eyeOff', onclick: async () => {
            if (p.status === 'published' && !(await confirmDialog({ title: `Unpublish "${p.name}"?`, body: 'Visitors will see an empty page until you publish a profile.', confirmLabel: 'Unpublish', danger: true }))) return;
            act(() => api(`/api/admin/profiles/${p.id}/status`, { method: 'POST', body: { status: p.status === 'published' ? 'draft' : 'hidden' } }), p.status === 'published' ? 'Unpublished.' : 'Hidden.');
          } }),
        iconBtn('trash', `Delete ${p.name}`, async () => {
          if (!(await confirmDialog({ title: `Delete "${p.name}"?`, body: 'This permanently deletes the profile and its content. Download a backup first if you might need it.', confirmLabel: 'Delete permanently', danger: true, typeToConfirm: p.name }))) return;
          act(() => api(`/api/admin/profiles/${p.id}`, { method: 'DELETE', body: { confirmName: p.name } }), 'Profile deleted.');
        }, { danger: true })))))));
}

// ---------- Inbox ----------
async function inbox(root, id) {
  let filter = sessionStorage.getItem('ps-inbox') || '';
  const listEl = h('ul', { class: 'msg-list' });
  const detail = h('div', { class: 'msg-detail' }, h('p', { class: 'empty', text: 'Select a message to read and reply.' }));
  const filters = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Filter messages' }, [['', 'Inbox'], ['new', 'Unread'], ['replied', 'Replied'], ['archived', 'Archived']].map(([v, l]) =>
    h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'mf', checked: filter === v, onchange: () => { filter = v; sessionStorage.setItem('ps-inbox', v); loadList(); } }), h('span', { text: l }))));
  const exportMenu = h('div', { class: 'row-tight wrap' },
    h('span', { class: 'hint', text: 'Export:' }),
    ...[['csv', 'all', 'All (CSV)'], ['json', 'all', 'All (JSON)'], ['csv', 'emails', 'E-mails only (CSV)'], ['json', 'emails', 'E-mails only (JSON)']].map(([f, s, l]) =>
      btn(l, { small: true, iconName: 'download', onclick: async () => {
        try {
          const res = await api(`/api/admin/messages/export?format=${f}&scope=${s}`, { raw: true });
          const name = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || `contacts.${f}`;
          download(await res.blob(), name);
        } catch (e) { toast(errorText(e), 'bad'); }
      } })));

  async function loadList() {
    try {
      const msgs = await api(`/api/admin/messages${filter ? `?status=${filter}` : ''}`);
      listEl.replaceChildren(...(msgs.length ? msgs.map((m) => h('li', {},
        h('a', { class: 'msg-row' + (m.status === 'new' ? ' unread' : ''), href: `#/inbox/${m.id}`, 'aria-current': m.id === id ? 'true' : 'false' },
          h('span', { class: 'msg-from', text: m.name }), h('span', { class: 'msg-date', text: fmtDate(m.created_at, false) }),
          h('span', { class: 'msg-subj', text: m.subject || '(no subject)' }), h('span', { class: 'msg-prev', text: m.preview }),
          m.status === 'replied' ? h('span', { class: 'badge badge-published', text: 'Replied' }) : null)))
        : [h('li', { class: 'empty', text: filter ? 'No messages here.' : 'No messages yet. Messages from your contact form appear here.' })]));
    } catch (e) { listEl.replaceChildren(h('li', { class: 'empty', text: errorText(e) })); }
  }

  async function loadDetail() {
    if (!id) return;
    try {
      const m = await api(`/api/admin/messages/${id}`);
      const body = h('textarea', { class: 'input', rows: 7, 'aria-label': 'Your reply' });
      const send = btn('Send reply', { kind: 'primary', iconName: 'reply' });
      const sendErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
      send.onclick = async () => {
        sendErr.hidden = true;
        send.disabled = true;
        try {
          await api(`/api/admin/messages/${m.id}/reply`, { method: 'POST', body: { body: body.value } });
          toast(`Reply sent to ${m.email}.`);
          loadDetail(); loadList();
        } catch (e) { sendErr.textContent = e.message; sendErr.hidden = false; send.disabled = false; }
      };
      detail.replaceChildren(
        h('div', { class: 'msg-head' },
          h('div', {}, h('h2', { text: m.subject || '(no subject)' }), h('p', { class: 'muted' }, `${m.name} `, h('a', { href: `mailto:${m.email}`, text: `<${m.email}>` }), ` · ${fmtDate(m.created_at)}`)),
          h('div', { class: 'row-tight' },
            btn(m.status === 'archived' ? 'Move to inbox' : 'Archive', { small: true, iconName: 'archive', onclick: async () => { await api(`/api/admin/messages/${m.id}`, { method: 'PATCH', body: { status: m.status === 'archived' ? 'read' : 'archived' } }); loadList(); loadDetail(); } }),
            btn('Mark unread', { small: true, onclick: async () => { await api(`/api/admin/messages/${m.id}`, { method: 'PATCH', body: { status: 'new' } }); location.hash = '#/inbox'; refreshNotices(); } }),
            iconBtn('trash', 'Delete message', async () => {
              if (!(await confirmDialog({ title: 'Delete this message?', body: `The message from ${m.name} and its replies will be deleted permanently.`, confirmLabel: 'Delete', danger: true }))) return;
              await api(`/api/admin/messages/${m.id}`, { method: 'DELETE', body: { confirm: true } });
              toast('Message deleted.');
              location.hash = '#/inbox';
            }, { danger: true }))),
        h('div', { class: 'msg-body', text: m.body }),
        ...m.replies.map((r) => h('div', { class: 'reply' + (r.status === 'failed' ? ' failed' : '') },
          h('p', { class: 'hint', text: r.status === 'failed' ? `Not sent, ${fmtDate(r.sent_at)}: ${r.error}` : `You replied, ${fmtDate(r.sent_at)}` }),
          h('div', { class: 'msg-body', text: r.body }))),
        h('div', { class: 'composer' }, h('label', { class: 'label', text: `Reply to ${m.email}` }), body, sendErr,
          h('div', { class: 'row space' }, h('p', { class: 'hint', text: 'Sent from your Gmail, with the original message quoted below.' }), send)));
      refreshNotices();
    } catch (e) { detail.replaceChildren(h('p', { class: 'empty', text: errorText(e) })); }
  }

  root.replaceChildren(...page('Inbox', 'Messages from your contact form.',
    h('div', { class: 'row space wrap' }, filters, exportMenu),
    h('div', { class: 'inbox' + (id ? ' has-detail' : '') }, h('div', { class: 'card card-flush' }, listEl), h('div', { class: 'card' }, id ? h('a', { class: 'back only-mobile', href: '#/inbox' }, icon('left'), 'All messages') : null, detail))));
  await loadList();
  await loadDetail();
}

// ---------- Appearance ----------
async function appearance(root) {
  let data;
  try { data = await api('/api/admin/theme'); } catch (e) { return root.replaceChildren(h('p', { class: 'empty', text: errorText(e) })); }
  const t = structuredClone(data.theme);
  const preview = h('div', { class: 'theme-preview' });
  const previewBox = h('div', { class: 'theme-preview-wrap' }, h('span', { class: 'preview-label', text: 'Live preview' }), preview);
  const contrastEl = h('p', { class: 'hint', role: 'status' });

  function draw() {
    applyTheme(t, { target: preview, persist: false });
    preview.replaceChildren(
      h('div', { class: 'tp-bg' }),
      h('div', { class: 'tp-nav' }, h('span', { class: 'mark', text: 'RV' }), h('span', { class: 'tp-line w40' }), h('span', { class: 'tp-pill', text: 'Contact' })),
      h('div', { class: 'tp-hero' }, h('div', { class: 'tp-sel' }, h('strong', { text: 'Your Name' })), h('span', { class: 'tp-line w60' }), h('span', { class: 'tp-line w80' }), h('span', { class: 'tp-pill', text: 'View my work' })),
      h('div', { class: 'tp-cards' }, h('span', { class: 'tp-card' }), h('span', { class: 'tp-card' }), h('span', { class: 'tp-card' })));
    if (t.mode === 'browser') contrastEl.textContent = 'Browser colours use the visitor’s own system colours, so the accent and background settings are ignored.';
    else {
      const c = contrast(t.accent, onAccent(t.accent));
      contrastEl.textContent = `Button text contrast: ${c.toFixed(1)}:1 ${c >= 4.5 ? '(passes WCAG AA)' : '(below 4.5:1, pick a darker or lighter accent)'}`;
    }
  }

  const modeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme mode' }, [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device'], ['browser', 'Browser colours']].map(([v, l]) =>
    h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'tm', checked: t.mode === v, onchange: () => { t.mode = v; draw(); } }), h('span', { text: l }))));
  const PRESETS = ['#0D7EF2', '#6D4AFF', '#0E9F6E', '#E8590C', '#D6336C', '#1F2937'];
  const accentIn = h('input', { type: 'color', value: t.accent, 'aria-label': 'Accent colour', oninput: (e) => { t.accent = e.target.value.toUpperCase(); hex.value = t.accent; draw(); } });
  const hex = h('input', { class: 'input input-hex', value: t.accent, 'aria-label': 'Accent colour hex', maxlength: 7, oninput: (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { t.accent = e.target.value.toUpperCase(); accentIn.value = t.accent; draw(); } } });
  const bgSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Background' }, [['canvas', 'Dotted canvas'], ['solid', 'Solid colour'], ['gradient', 'Gradient']].map(([v, l]) =>
    h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'bg', checked: t.background.type === v, onchange: () => { t.background.type = v; drawBg(); draw(); } }), h('span', { text: l }))));
  const bgOpts = h('div', { class: 'stack-sm' });
  const colorField = (lbl, obj, key) => h('label', { class: 'color-field' }, h('input', { type: 'color', value: obj[key], oninput: (e) => { obj[key] = e.target.value.toUpperCase(); draw(); } }), h('span', { text: lbl }));
  function drawBg() {
    const g = t.background.gradient;
    const angle = h('input', { type: 'range', min: 0, max: 360, value: g.angle, 'aria-label': 'Gradient angle' });
    const angleOut = h('output', { text: `${g.angle}°` });
    angle.addEventListener('input', () => { g.angle = Number(angle.value); angleOut.textContent = `${g.angle}°`; draw(); });
    bgOpts.replaceChildren(
      t.background.type === 'solid' ? colorField('Background colour', t.background, 'solid') : null,
      t.background.type === 'gradient' ? h('div', { class: 'stack-sm' }, h('div', { class: 'row' }, colorField('From', g, 'from'), colorField('To', g, 'to')),
        h('label', { class: 'ie-slider' }, h('span', { text: 'Angle' }), angle, angleOut),
        toggle('Slowly animate the gradient', g.animate, (v) => { g.animate = v; draw(); }, 'Turned off automatically for visitors who prefer reduced motion.')) : null,
      t.background.type === 'canvas' ? h('p', { class: 'hint', text: 'A soft dotted grid, adapted for light and dark modes.' })
        : h('p', { class: 'hint', text: 'With a custom background, light or dark text is picked automatically from your colours so everything stays readable. Visitors who switch light/dark themselves see the dotted canvas instead.' }));
  }
  drawBg();
  draw();

  root.replaceChildren(...page('Appearance', 'Theme for the public website. Changes apply after you save.',
    h('div', { class: 'appearance' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('h2', { text: 'Mode' }), modeSeg, h('p', { class: 'hint', text: 'Visitors can still switch light or dark with the button in the site header.' })),
        h('section', { class: 'card' }, h('h2', { text: 'Accent colour' }),
          h('div', { class: 'row wrap' }, accentIn, hex, ...PRESETS.map((c) => h('button', { class: 'swatch', type: 'button', style: `background:${c}`, 'aria-label': `Use ${c}`, title: c, onclick: () => { t.accent = c; accentIn.value = c; hex.value = c; draw(); } }))),
          contrastEl),
        h('section', { class: 'card' }, h('h2', { text: 'Background' }), bgSeg, bgOpts),
        h('div', { class: 'row' },
          btn('Save theme', { kind: 'primary', iconName: 'check', onclick: async () => {
            try { const out = await api('/api/admin/theme', { method: 'PUT', body: t }); siteTheme = out.theme; applyTheme(siteTheme, { overrideMode: adminMode() }); toast('Theme saved. The site is updated.'); } catch (e) { toast(errorText(e), 'bad'); }
          } }),
          btn('Reset to defaults', { onclick: async () => {
            if (!(await confirmDialog({ title: 'Reset the theme?', body: 'Mode, accent and background go back to the defaults. You still need to save.', confirmLabel: 'Reset' }))) return;
            Object.assign(t, structuredClone(data.defaults));
            appearance(root).then(() => {});
            api('/api/admin/theme', { method: 'PUT', body: data.defaults }).then((out) => { siteTheme = out.theme; applyTheme(siteTheme, { overrideMode: adminMode() }); toast('Theme reset to defaults.'); });
          } }))),
      previewBox)));
}

// ---------- E-mail ----------
async function email(root) {
  let cfg;
  try { cfg = await api('/api/admin/email'); } catch (e) { return root.replaceChildren(h('p', { class: 'empty', text: errorText(e) })); }
  const addr = h('input', { class: 'input', type: 'email', value: cfg.gmailAddress, autocomplete: 'email' });
  const from = h('input', { class: 'input', value: cfg.fromName, maxlength: 80 });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: cfg.hasAppPassword ? '•••• •••• •••• •••• (saved)' : 'abcd efgh ijkl mnop', spellcheck: 'false' });
  let notify = cfg.notifyOnContact;
  const status = h('div', { class: 'stack-sm' });
  const drawStatus = (c) => {
    status.replaceChildren(
      !c.hasAppPassword || !c.gmailAddress ? h('div', { class: 'callout callout-info' }, h('strong', { text: 'Not set up yet.' }), h('p', { text: 'Messages are still saved to your inbox. Add your Gmail and App Password to reply from here and get notified.' }))
        : c.lastCheck?.ok ? h('div', { class: 'callout callout-ok' }, h('strong', { text: 'Connected to Gmail.' }), h('p', { text: `Checked ${fmtDate(c.lastCheck.at)}.` }))
          : c.lastCheck ? h('div', { class: 'callout callout-bad' }, h('strong', { text: 'The last check failed.' }), h('p', { text: c.lastCheck.error }))
            : h('div', { class: 'callout callout-info' }, h('strong', { text: 'Saved, not tested.' }), h('p', { text: 'Run "Test connection" to make sure Gmail accepts the App Password.' })));
  };
  drawStatus(cfg);
  const testTo = h('input', { class: 'input', type: 'email', placeholder: 'Send a test to… (optional)', 'aria-label': 'Send a test e-mail to' });
  const testBtn = btn('Test connection', { iconName: 'check', onclick: async () => {
    testBtn.disabled = true;
    try { const out = await api('/api/admin/email/test', { method: 'POST', body: { sendTo: testTo.value.trim() || undefined } }); toast(out.sent ? `Connected. Test e-mail sent to ${testTo.value}.` : 'Connected to Gmail.'); }
    catch (e) { toast(e.message, 'bad'); }
    finally { testBtn.disabled = false; drawStatus(await api('/api/admin/email')); refreshNotices(); }
  } });
  root.replaceChildren(...page('E-mail', 'Send replies and new-message notifications through your Gmail account.',
    status,
    h('section', { class: 'card' }, h('h2', { text: 'Gmail account' }),
      h('div', { class: 'grid-2' }, field('Gmail address', addr), field('Sender name', from, 'Shown as the "From" name, for example your full name.')),
      field('App Password', pw, cfg.hasAppPassword ? `Saved ${fmtDate(cfg.appPasswordUpdatedAt)}. Stored encrypted on the server and never shown again. Leave empty to keep it.` : 'The 16-letter password from Google Account → Security → 2-Step Verification → App passwords. Not your normal Gmail password.'),
      toggle('E-mail me when someone uses the contact form', notify, (v) => { notify = v; }),
      h('div', { class: 'row wrap' },
        btn('Save', { kind: 'primary', iconName: 'check', onclick: async () => {
          try { const out = await api('/api/admin/email', { method: 'PUT', body: { gmailAddress: addr.value.trim(), fromName: from.value, appPassword: pw.value || undefined, notifyOnContact: notify } }); pw.value = ''; pw.placeholder = '•••• •••• •••• •••• (saved)'; drawStatus(out); toast('E-mail settings saved.'); refreshNotices(); } catch (e) { toast(errorText(e), 'bad'); }
        } }),
        cfg.hasAppPassword ? btn('Remove App Password', { kind: 'danger-ghost', onclick: async () => {
          if (!(await confirmDialog({ title: 'Remove the App Password?', body: 'You won’t be able to send replies until you add one again. Also revoke it in your Google Account.', confirmLabel: 'Remove', danger: true }))) return;
          await api('/api/admin/email/app-password', { method: 'DELETE', body: {} }); toast('App Password removed.'); email(root); refreshNotices();
        } }) : null)),
    h('section', { class: 'card' }, h('h2', { text: 'Check the connection' }), h('div', { class: 'row wrap' }, testTo, testBtn),
      h('p', { class: 'hint', text: 'Hosting note: Render’s free plan blocks outgoing mail ports. If the test says the server can’t be reached, move the web service to a paid instance.' }))));
}

// ---------- Backup ----------
async function backup(root) {
  let includeFiles = true;
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'restore-file' });
  const result = h('div', { class: 'stack-sm', 'aria-live': 'polite' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    result.replaceChildren(h('p', { class: 'hint', text: 'Checking the file…' }));
    let json;
    try { json = JSON.parse(await f.text()); } catch { return result.replaceChildren(h('div', { class: 'callout callout-bad' }, h('strong', { text: 'This file isn’t valid JSON.' }), h('p', { text: 'Choose a backup downloaded from this admin.' }))); }
    try {
      const v = await api('/api/admin/restore/validate', { method: 'POST', body: json });
      if (!v.ok) return result.replaceChildren(h('div', { class: 'callout callout-bad' }, h('strong', { text: 'This backup can’t be restored.' }), h('ul', {}, v.problems.map((p) => h('li', { text: p })))));
      const s = v.summary;
      result.replaceChildren(h('div', { class: 'callout callout-info' },
        h('strong', { text: `Backup from ${fmtDate(s.exportedAt)} looks good.` }),
        h('ul', {}, s.profiles.map((p) => h('li', { text: `${p.name} (${label(p.status)})` })), h('li', { text: `${s.files} image/PDF file${s.files === 1 ? '' : 's'}` }), s.theme ? h('li', { text: 'Theme settings' }) : null),
        h('p', { text: 'Restoring replaces all current profiles and the theme. Your admin account, password, e-mail settings and messages are not changed.' }),
        btn('Restore this backup', { kind: 'danger', onclick: async () => {
          if (!(await confirmDialog({ title: 'Replace current content?', body: 'All current profiles and the theme will be replaced by the backup. Download a backup of the current state first if you might need it.', confirmLabel: 'Restore', danger: true, typeToConfirm: 'RESTORE' }))) return;
          try { await api('/api/admin/restore', { method: 'POST', body: { backup: json, confirm: true } }); toast('Backup restored.'); result.replaceChildren(); refreshNotices(); } catch (e) { toast(errorText(e), 'bad'); }
        } })));
    } catch (e) { result.replaceChildren(h('div', { class: 'callout callout-bad' }, h('strong', { text: errorText(e) }))); }
    fileIn.value = '';
  });
  const dl = (path, fallback) => async () => {
    try {
      const res = await api(path, { raw: true });
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || fallback;
      download(await res.blob(), name);
      toast('Download started.');
    } catch (e) { toast(errorText(e), 'bad'); }
  };
  root.replaceChildren(...page('Backup & export', null,
    h('section', { class: 'card' }, h('h2', { text: 'Download a backup' }),
      h('p', { class: 'muted', text: 'Saves every profile, its content and the theme as one JSON file. Passwords, verification codes, the Gmail App Password and sessions are never included.' }),
      toggle('Include uploaded images and resume PDFs', includeFiles, (v) => { includeFiles = v; }, 'Makes the file larger, but lets you restore everything on a new server.'),
      h('div', { class: 'row' }, btn('Download backup', { kind: 'primary', iconName: 'download', onclick: () => dl(`/api/admin/backup?files=${includeFiles}`, 'portfolio-backup.json')() }))),
    h('section', { class: 'card' }, h('h2', { text: 'Restore from a backup' }),
      h('p', { class: 'muted', text: 'The file is checked first. Nothing changes until you confirm.' }),
      h('div', { class: 'row' }, h('label', { class: 'btn', for: 'restore-file' }, icon('upload'), 'Choose backup file'), fileIn), result),
    h('section', { class: 'card' }, h('h2', { text: 'Export contacts' }),
      h('p', { class: 'muted', text: 'Everyone who wrote through your contact form.' }),
      h('div', { class: 'row wrap' },
        btn('All messages (CSV)', { iconName: 'download', onclick: dl('/api/admin/messages/export?format=csv&scope=all', 'contacts.csv') }),
        btn('All messages (JSON)', { iconName: 'download', onclick: dl('/api/admin/messages/export?format=json&scope=all', 'contacts.json') }),
        btn('E-mails only (CSV)', { iconName: 'download', onclick: dl('/api/admin/messages/export?format=csv&scope=emails', 'emails.csv') }),
        btn('E-mails only (JSON)', { iconName: 'download', onclick: dl('/api/admin/messages/export?format=json&scope=emails', 'emails.json') })))));
}

// ---------- Security ----------
async function security(root) {
  let s;
  try { s = await api('/api/admin/security'); } catch (e) { return root.replaceChildren(h('p', { class: 'empty', text: errorText(e) })); }
  const recEmail = h('input', { class: 'input', type: 'email', value: s.recoveryEmail });
  const recCode = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const auditBox = h('div', {});
  root.replaceChildren(...page('Account & security', `Signed in as ${s.username}.`,
    s.usesDefaultPassword ? h('div', { class: 'callout callout-warn' }, h('strong', { text: 'The default password is still in use.' }), h('p', { text: 'Change it below.' })) : null,
    h('section', { class: 'card' }, h('h2', { text: 'Change password' }),
      passwordForm({ needCurrent: true, submitLabel: 'Change password', onSubmit: async ({ current, next }) => {
        await api('/api/auth/change-password', { method: 'POST', body: { current, next } });
        toast('Password changed. Other devices were signed out.');
        refreshNotices();
        security(root);
      } })),
    h('section', { class: 'card' }, h('h2', { text: 'Recovery e-mail' }),
      h('p', { class: 'muted', text: 'After a correct recovery code, a reset link is sent here. Requires e-mail to be set up.' }),
      h('div', { class: 'row wrap' }, recEmail, btn('Save', { kind: 'primary', onclick: async () => {
        try { await api('/api/admin/security/recovery-email', { method: 'PUT', body: { email: recEmail.value.trim() } }); toast('Recovery e-mail saved.'); } catch (e) { toast(errorText(e), 'bad'); }
      } }))),
    h('section', { class: 'card' }, h('h2', { text: 'Recovery code' }),
      h('p', { class: 'muted', text: s.customRecoveryCode ? 'A custom recovery code is set. It replaces the one from the server settings.' : s.envRecoveryCode ? 'Using the recovery code from the server settings. You can replace it here.' : 'No recovery code is set, so the recovery flow can’t be used. Set one here.' }),
      h('div', { class: 'row wrap' }, recCode, btn('Set recovery code', { kind: 'primary', onclick: async () => {
        try { await api('/api/admin/security/recovery-code', { method: 'PUT', body: { code: recCode.value } }); recCode.value = ''; toast('Recovery code saved. Keep it somewhere safe.'); security(root); } catch (e) { toast(errorText(e), 'bad'); }
      } }), s.customRecoveryCode ? btn('Remove custom code', { onclick: async () => { await api('/api/admin/security/recovery-code', { method: 'PUT', body: { code: '' } }); toast('Custom recovery code removed.'); security(root); } }) : null),
      h('p', { class: 'hint', text: 'At least 8 characters. It’s stored as a hash and can’t be viewed later.' })),
    h('section', { class: 'card' }, h('h2', { text: 'Recovery requests' }),
      s.recoveryRequests.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', { text: 'When' }), h('th', { text: 'Admin ID entered' }), h('th', { text: 'Result' }), h('th', { text: 'Status' }), h('th', {}))),
        h('tbody', {}, s.recoveryRequests.map((r) => h('tr', {}, h('td', { text: fmtDate(r.created_at) }), h('td', { text: r.username }), h('td', { text: r.note || '' }), h('td', { text: r.status }),
          h('td', {}, r.status === 'queued' ? btn('Close', { small: true, onclick: async () => { await api(`/api/admin/security/recovery-requests/${r.id}`, { method: 'PATCH', body: {} }); security(root); refreshNotices(); } }) : null)))))
        : h('p', { class: 'hint', text: 'No recovery requests.' })),
    h('section', { class: 'card' }, h('h2', { text: 'Activity log' }), btn('Show recent activity', { small: true, onclick: async () => {
      const rows = await api('/api/admin/audit');
      auditBox.replaceChildren(h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', { text: 'When' }), h('th', { text: 'Who' }), h('th', { text: 'What' }))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { text: fmtDate(r.at) }), h('td', { text: r.actor }), h('td', { text: r.action.replace(/[._]/g, ' ') }))))));
    } }), auditBox)));
}

boot();
