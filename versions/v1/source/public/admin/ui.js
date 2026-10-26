// Small UI toolkit for the admin: safe element builder, icons, toasts,
// confirmation dialogs and the API client.

// DOM append/replaceChildren treat null as the text "null". The admin builds
// views with optional parts, so drop empty values everywhere.
for (const m of ['append', 'replaceChildren', 'prepend']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...kids) {
    return orig.apply(this, kids.filter((k) => k !== null && k !== undefined && k !== false));
  };
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

const PATHS = {
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l1 8v6H4v-6Z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.9-.7-1.4-.7-2.3 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4c0-4.4-4-8.5-9-8.5Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  archive: '<path d="M4 4h16v4H4zM5 8v11h14V8M10 12h4"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.5 7.6C3.8 9.4 2 12 2 12s3.6 6 10 6c1.3 0 2.5-.2 3.6-.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ext: '<path d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4M5 5h14"/>',
  rotL: '<path d="M4 4v5h5"/><path d="M4.5 9A8 8 0 1 1 4 13"/>',
  rotR: '<path d="M20 4v5h-5"/><path d="M19.5 9A8 8 0 1 0 20 13"/>',
  flipH: '<path d="M12 3v18M8 7 3 12l5 5V7ZM16 7l5 5-5 5V7Z"/>',
  flipV: '<path d="M3 12h18M7 8l5-5 5 5H7ZM7 16l5 5 5-5H7Z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m14 6 4 4"/>',
  warn: '<path d="M12 4 2 20h20Z"/><path d="M12 10v4M12 17v.5"/>',
};

export function icon(name, cls = 'ico') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls);
  s.innerHTML = PATHS[name] || '';
  return s;
}

export function btn(label, opts = {}) {
  const { kind = '', iconName, onclick, type = 'button', title, small, disabled } = opts;
  return h('button', {
    class: ['btn', kind && `btn-${kind}`, small && 'btn-sm'].filter(Boolean).join(' '),
    type, title, onclick, disabled, 'aria-label': opts.ariaLabel,
  }, iconName ? icon(iconName) : null, label ? h('span', { text: label }) : null);
}

export function iconBtn(name, label, onclick, extra = {}) {
  return h('button', { class: 'icon-btn' + (extra.danger ? ' danger' : ''), type: 'button', 'aria-label': label, title: label, onclick, disabled: extra.disabled }, icon(name));
}

// ---------- toasts ----------
export function toast(msg, kind = 'ok') {
  const host = document.querySelector('.toasts');
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, icon(kind === 'bad' ? 'warn' : 'check'), h('span', { text: msg }));
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'bad' ? 6000 : 3000);
}

// ---------- confirm dialog ----------
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, typeToConfirm = null }) {
  return new Promise((resolve) => {
    const input = typeToConfirm ? h('input', { class: 'input', type: 'text', 'aria-label': `Type ${typeToConfirm} to confirm`, autocomplete: 'off' }) : null;
    const ok = btn(confirmLabel, { kind: danger ? 'danger' : 'primary' });
    const cancel = btn('Cancel');
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title', text: title }),
      typeof body === 'string' ? h('p', { text: body }) : body,
      typeToConfirm ? h('label', { class: 'field' }, h('span', {}, 'Type ', h('strong', { text: typeToConfirm }), ' to confirm'), input) : null,
      h('div', { class: 'dialog-actions' }, cancel, ok));
    document.body.append(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    if (input) {
      ok.disabled = true;
      input.addEventListener('input', () => { ok.disabled = input.value !== typeToConfirm; });
    }
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    dlg.showModal();
    (input || cancel).focus();
  });
}

// ---------- API ----------
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body || {};
  }
}

export const events = new EventTarget();

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'portfolio-admin' }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, { error: "Can't reach the server. Check your connection and try again." });
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !path.startsWith('/api/auth/login')) events.dispatchEvent(new Event('signed-out'));
    if (data.code === 'MUST_CHANGE_PASSWORD') events.dispatchEvent(new Event('must-change'));
    throw err;
  }
  return data;
}

export function errorText(e) {
  if (e?.body?.details?.length) return `${e.message} ${e.body.details.join(' ')}`;
  return e?.message || 'Something went wrong.';
}

export function fmtDate(d, withTime = true) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function download(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function field(label, control, hint) {
  const id = control.id || 'f_' + Math.random().toString(36).slice(2, 9);
  control.id = id;
  const hintEl = hint ? h('p', { class: 'hint', id: id + '-hint', text: hint }) : null;
  if (hintEl) control.setAttribute('aria-describedby', id + '-hint');
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), control, hintEl);
}

export function toggle(label, checked, onchange, hint) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, onchange: (e) => onchange(e.target.checked) });
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', { class: 'switch-text' }, label, hint ? h('small', { text: hint }) : null));
}
