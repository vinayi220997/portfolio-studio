import { applyTheme, watchSystem } from '/shared/theme.js';

const $ = (s, el = document) => el.querySelector(s);

// Same code runs on Render (same-origin API) and on GitHub Pages, where
// config.js sets the Render address, a bundled snapshot and the base path.
const CFG = window.PORTFOLIO_CONFIG || {};
const API = String(CFG.api || '').replace(/\/$/, '');
const BASE = CFG.base || '/';
const apiUrl = (p) => API + p;
const assetUrl = (p) => {
  if (!p) return p;
  if (p.startsWith('/files/') || p.startsWith('/favicon')) return API + p;
  if (p.startsWith('/')) return BASE + p.slice(1);
  return p;
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Safe element builder: text is always set with textContent (no HTML injection).
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

const ICON = {
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  open: '<path d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[name];
  return s;
};

let site = null;

// ---------- theme ----------
const MODES = ['system', 'light', 'dark'];
function visitorMode() {
  try { return localStorage.getItem('ps-visitor-mode'); } catch { return null; }
}
function setupModeButton() {
  const btn = $('#mode-btn');
  const label = () => {
    const m = visitorMode() || 'system';
    btn.replaceChildren(icon(m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'auto'));
    btn.setAttribute('aria-label', `Colour theme: ${m === 'system' ? 'match device' : m}. Change theme`);
    btn.title = btn.getAttribute('aria-label');
  };
  btn.addEventListener('click', () => {
    const cur = visitorMode() || 'system';
    const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
    try {
      if (next === 'system') localStorage.removeItem('ps-visitor-mode');
      else localStorage.setItem('ps-visitor-mode', next);
    } catch { /* storage blocked */ }
    applyTheme(site.theme, { overrideMode: next === 'system' ? null : next });
    label();
  });
  label();
}

// ---------- render ----------
async function getJson(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error('Site data unavailable');
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

let started = false;
function show(data, live) {
  site = data;
  applyTheme(site.theme, { overrideMode: visitorMode() });
  if (!started) {
    started = true;
    watchSystem(() => site.theme, visitorMode);
    setupModeButton();
  }
  const empty = !site.profile;
  $('.hero').hidden = empty;
  $('.empty-state').hidden = !empty;
  if (!empty) render(site.profile, live);
}

async function load() {
  if (!CFG.snapshot) return show(await getJson(apiUrl('/api/public/site'), 30000), true);
  // GitHub Pages: ask the live server first. A sleeping free Render service can
  // take up to a minute to wake, so after a short wait show the bundled
  // snapshot, then swap in live content as soon as it arrives.
  const live = getJson(apiUrl('/api/public/site'), 90000).then((d) => ({ d }), () => null);
  const first = await Promise.race([live, new Promise((r) => setTimeout(() => r('slow'), CFG.waitMs || 4500))]);
  if (first && first !== 'slow') return show(first.d, true);
  let snap = null;
  try { snap = await getJson(CFG.snapshot, 10000); show(snap, false); } catch { /* no snapshot */ }
  const late = await live;
  if (late) {
    if (!snap || JSON.stringify(late.d) !== JSON.stringify(snap)) show(late.d, true);
  } else if (!snap) throw new Error('Site data unavailable');
}

function render(p, live = true) {
  document.title = `${p.displayName}${firstTitle(p) ? ' — ' + firstTitle(p) : ''}`;
  const desc = document.querySelector('meta[name=description]');
  if (desc && p.intro) desc.setAttribute('content', p.intro);
  // Bust the favicon cache so logo/colour edits show straight away.
  if (live) $('#favicon').href = assetUrl('/favicon.svg') + '?v=' + Date.now();

  const mark = $('.mark');
  mark.textContent = p.logo.letters;
  mark.dataset.shape = p.logo.shape;
  $('.brand-name').textContent = p.displayName;

  renderHero(p);
  const container = $('#sections');
  container.replaceChildren();
  const navItems = [];
  for (const s of p.sections) {
    const el = SECTION[s.key]?.(p, s);
    if (!el) continue;
    container.append(el);
    navItems.push({ id: s.key, title: s.title });
  }
  renderNav(navItems);
  $('.foot-copy').textContent = `© ${new Date().getFullYear()} ${p.displayName}`;
  observeReveals();
}

const firstTitle = (p) => p.titles.split(',').map((t) => t.trim()).filter(Boolean)[0] || '';

function renderNav(items) {
  for (const sel of ['.nav ul', '.mobile-nav ul']) {
    $(sel).replaceChildren(...items.map((i) => h('li', {}, h('a', { href: `#${i.id}`, text: i.title }))));
  }
  const menuBtn = $('#menu-btn'), mobile = $('#mobile-nav');
  menuBtn.onclick = () => {
    const open = mobile.hidden;
    mobile.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  mobile.addEventListener('click', (e) => {
    if (e.target.closest('a')) { mobile.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  });
  // Highlight the section in view.
  const links = [...document.querySelectorAll('.nav a')];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + e.target.id)));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  items.forEach((i) => { const s = document.getElementById(i.id); if (s) io.observe(s); });
  // Back at the top: nothing is current.
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) links.forEach((a) => a.setAttribute('aria-current', 'false'));
  }, { rootMargin: '-45% 0px -50% 0px' }).observe($('.hero'));
}

function renderHero(p) {
  const name = $('#hero-name');
  name.textContent = p.displayName;
  $('.sel-label').textContent = p.location || 'Portfolio';
  const sel = $('[data-sel]');
  const size = $('.sel-size');
  // Shrink the selection frame to the rendered text lines, then label its size.
  const measure = () => {
    name.style.width = '';
    const range = document.createRange();
    range.selectNodeContents(name);
    const rects = [...range.getClientRects()];
    if (rects.length) {
      const w = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
      name.style.width = Math.ceil(w + 2) + 'px';
    }
    size.textContent = `${Math.round(sel.offsetWidth)} × ${Math.round(sel.offsetHeight)}`;
  };
  measure();
  document.fonts?.ready.then(measure);
  new ResizeObserver(() => requestAnimationFrame(measure)).observe(sel.parentElement);
  requestAnimationFrame(() => sel.classList.add('is-in'));

  renderTitles(p);
  $('.intro').textContent = p.intro;
  $('.intro').hidden = !p.intro;

  const actions = $('.hero-actions');
  actions.replaceChildren();
  const visible = new Set(p.sections.map((s) => s.key));
  if (visible.has('work') && p.projects.length) actions.append(h('a', { class: 'btn btn-solid', href: '#work', text: 'View my work' }));
  else if (visible.has('contact')) actions.append(h('a', { class: 'btn btn-solid', href: '#contact', text: 'Get in touch' }));
  const resume = resumeActions(p.resume);
  if (resume) actions.append(resume);

  // Avatar
  const wrap = $('.avatar-wrap');
  wrap.dataset.style = p.avatar.style;
  const src = assetUrl(p.avatar.fileId ? `/files/${p.avatar.fileId}` : p.avatar.src);
  wrap.replaceChildren(
    src
      ? h('img', { src, alt: p.avatar.alt || p.displayName, width: 482, height: 1253, decoding: 'async', fetchpriority: 'high' })
      : h('div', { class: 'initials', role: 'img', 'aria-label': p.displayName, text: p.logo.letters })
  );
  const img = wrap.querySelector('img');
  // "Cutout" seats the figure on the card: the card starts at hip height and
  // the legs overlap its front. Other styles overlap the card slightly.
  const seat = () => {
    const card = $('.now-card');
    const hgt = (img && img.offsetHeight) || wrap.offsetHeight;
    const overlap = p.avatar.style === 'cutout' ? hgt * 0.47 : p.avatar.style === 'layered' ? hgt * 0.12 : hgt * 0.16;
    card.style.setProperty('--seat', `-${Math.round(overlap)}px`);
    card.style.setProperty('--seat-pad', `${Math.round(overlap)}px`);
  };
  if (img) { img.addEventListener('load', seat); new ResizeObserver(seat).observe(img); } else seat();
  if (img) img.onerror = () => wrap.replaceChildren(h('div', { class: 'initials', role: 'img', 'aria-label': p.displayName, text: p.logo.letters }));

  // "Currently" card built from the latest role, plus availability if set.
  const card = $('.now-card');
  const job = p.experience[0];
  const rows = [];
  if (job) rows.push(h('div', { class: 'row' }, h('div', {}, h('p', { class: 'k', text: job.end && !/present/i.test(job.end) ? 'Most recently' : 'Currently' }), h('p', { class: 'v', text: `${job.role}, ${job.company}` }))));
  if (p.availability) rows.push(h('div', { class: 'row' }, h('div', {}, h('p', { class: 'k', text: 'Availability' }), h('p', { class: 'v', text: p.availability }))));
  if (p.location) rows.push(h('div', { class: 'row' }, h('div', {}, h('p', { class: 'k', text: 'Based in' }), h('p', { class: 'v', text: p.location }))));
  card.replaceChildren(...rows);
  card.hidden = rows.length === 0;
}

let typingTimer = null;
function renderTitles(p) {
  const el = $('.titles');
  clearTimeout(typingTimer);
  const titles = p.titles.split(',').map((t) => t.trim()).filter(Boolean);
  el.replaceChildren();
  if (!titles.length) { el.hidden = true; return; }
  el.hidden = false;
  el.setAttribute('aria-label', titles.join(', '));
  if (!p.typing || reduceMotion || titles.length === 1) {
    titles.forEach((t, i) => { if (i) el.append(h('span', { class: 'sep', 'aria-hidden': 'true' })); el.append(t); });
    return;
  }
  const text = h('span', { 'aria-hidden': 'true' });
  el.append(text, h('span', { class: 'caret', 'aria-hidden': 'true' }));
  let ti = 0, ci = 0, deleting = false;
  const tick = () => {
    const word = titles[ti];
    if (!deleting) {
      ci++;
      text.textContent = word.slice(0, ci);
      if (ci === word.length) { deleting = true; typingTimer = setTimeout(tick, 1600); return; }
      typingTimer = setTimeout(tick, 70);
    } else {
      ci--;
      text.textContent = word.slice(0, ci);
      if (ci === 0) { deleting = false; ti = (ti + 1) % titles.length; typingTimer = setTimeout(tick, 350); return; }
      typingTimer = setTimeout(tick, 35);
    }
  };
  typingTimer = setTimeout(tick, 900);
}

function resumeActions(r) {
  const href = r.mode === 'file' ? (r.fileId ? assetUrl(`/files/${r.fileId}`) : '') : r.url;
  if (!href) return null;
  const group = h('div', { class: 'resume-group', role: 'group', 'aria-label': r.label });
  if (r.showDownload) {
    const dl = r.mode === 'file' ? `${href}?download=1` : href;
    group.append(h('a', { class: 'btn', href: dl, ...(r.mode === 'file' ? { download: r.fileName || 'resume.pdf' } : { target: '_blank', rel: 'noopener' }) }, icon('download'), `Download ${r.label.toLowerCase()}`));
  }
  if (r.showOpen) group.append(h('a', { class: 'btn', href, target: '_blank', rel: 'noopener', 'aria-label': `Open ${r.label} in a new tab` }, icon('open'), 'Open'));
  if (r.showPreview) group.append(h('button', { class: 'btn', type: 'button', onclick: () => previewResume(r, href) }, icon('eye'), 'Preview'));
  return group.children.length ? group : null;
}

function previewResume(r, href) {
  const dlg = $('#resume-dialog');
  $('#resume-title').textContent = r.label;
  const frame = $('.modal-frame');
  // Google Drive "view" links preview better through /preview.
  frame.src = href.replace(/drive\.google\.com\/file\/d\/([^/]+)\/view.*/, 'drive.google.com/file/d/$1/preview');
  $('.modal-actions').replaceChildren(h('a', { class: 'btn btn-sm', href, target: '_blank', rel: 'noopener' }, icon('open'), 'Open in new tab'));
  dlg.showModal();
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.onclose = () => { frame.src = 'about:blank'; };
}

function sectionShell(s, note) {
  return h('section', { class: 'section', id: s.key, 'aria-labelledby': `${s.key}-title` },
    h('div', { class: 'section-head reveal' }, h('h2', { class: 'section-title', id: `${s.key}-title`, text: s.title }), note ? h('p', { class: 'section-note', text: note }) : null));
}

const SECTION = {
  work(p, s) {
    if (!p.projects.length) return null;
    const sec = sectionShell(s, `${p.projects.length} ${p.projects.length === 1 ? 'project' : 'projects'}`);
    sec.append(h('div', { class: 'work-grid' }, p.projects.map((pr) => {
      const img = pr.imageFileId ? assetUrl(`/files/${pr.imageFileId}`) : pr.imageUrl;
      const initials = pr.title.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      return h('article', { class: 'project reveal' },
        h('span', { class: 'frame-label', 'aria-hidden': 'true', text: pr.title }),
        h('div', { class: 'frame' },
          img ? h('img', { class: 'cover', src: img, alt: '', loading: 'lazy' }) : h('div', { class: 'cover-gen', 'aria-hidden': 'true' }, h('span', { text: initials })),
          h('div', { class: 'project-body' },
            h('h3', { text: pr.title }),
            [pr.role, pr.year].filter(Boolean).length ? h('p', { class: 'meta', text: [pr.role, pr.year].filter(Boolean).join(', ') }) : null,
            pr.summary ? h('p', { class: 'sum', text: pr.summary }) : null,
            pr.tags.length ? h('ul', { class: 'tags', 'aria-label': 'Tags' }, pr.tags.map((t) => h('li', { text: t }))) : null,
            pr.link ? h('a', { class: 'more', href: pr.link, target: '_blank', rel: 'noopener', text: pr.linkLabel || 'View project' }) : null)));
    })));
    return sec;
  },

  about(p, s) {
    if (!p.about) return null;
    const sec = sectionShell(s);
    const tiles = [h('div', { class: 'tile tile-about reveal' }, h('p', { text: p.about }))];
    if (p.location) tiles.push(h('div', { class: 'tile tile-side reveal' }, h('h3', { text: 'Based in' }), h('p', { class: 'big', text: p.location })));
    if (p.links.length) tiles.push(h('div', { class: 'tile tile-side reveal' }, h('h3', { text: 'Elsewhere' }),
      h('ul', { class: 'link-list' }, p.links.map((l) => h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener me' }, h('span', { text: l.label }), icon('open')))))));
    sec.append(h('div', { class: 'bento' }, tiles));
    return sec;
  },

  experience(p, s) {
    if (!p.experience.length) return null;
    const sec = sectionShell(s);
    sec.append(h('ol', { class: 'timeline', reversed: true }, p.experience.map((j) =>
      h('li', { class: 'job reveal' },
        h('p', { class: 'when', text: [j.start, j.end].filter(Boolean).join(' – ') }),
        h('div', {},
          h('h3', { text: j.role }),
          h('p', { class: 'org', text: [j.company, j.location].filter(Boolean).join(', ') }),
          j.points.length ? h('ul', {}, j.points.map((pt) => h('li', { text: pt }))) : null)))));
    return sec;
  },

  skills(p, s) {
    if (!p.skills.length) return null;
    const sec = sectionShell(s);
    sec.append(h('div', { class: 'skills-grid' }, p.skills.map((sk) =>
      h('div', { class: 'frame skill reveal' },
        h('h3', { text: sk.name }),
        sk.summary ? h('p', { text: sk.summary }) : null,
        sk.tools.length ? h('ul', { class: 'chips', 'aria-label': `${sk.name} tools` }, sk.tools.map((t) => h('li', { text: t }))) : null))));
    return sec;
  },

  education(p, s) {
    if (!p.education.length) return null;
    const sec = sectionShell(s);
    sec.append(h('div', { class: 'cards-2' }, p.education.map((e) =>
      h('div', { class: 'frame edu reveal' },
        h('h3', { text: [e.degree, e.field].filter(Boolean).join(', ') }),
        h('p', { text: [e.school, [e.start, e.end].filter(Boolean).join(' – ')].filter(Boolean).join(', ') })))));
    return sec;
  },

  certifications(p, s) {
    if (!p.certifications.length) return null;
    const sec = sectionShell(s);
    sec.append(h('div', { class: 'cards-2' }, p.certifications.map((c) =>
      h('div', { class: 'frame edu reveal' },
        h('h3', {}, c.link ? h('a', { href: c.link, target: '_blank', rel: 'noopener', text: c.name }) : c.name),
        h('p', { text: [c.issuer, c.year].filter(Boolean).join(', ') || ' ' })))));
    return sec;
  },

  contact(p, s) {
    const sec = sectionShell(s);
    const emails = [...p.emails].sort((a, b) => b.primary - a.primary);
    const phones = [...p.phones].sort((a, b) => b.primary - a.primary);
    const left = h('div', { class: 'reveal' },
      h('p', { class: 'contact-lead', text: 'Have a project or a role in mind? Write to me.' }),
      h('ul', { class: 'contact-list' },
        emails.map((e) => contactItem(e.label, e.address, `mailto:${e.address}`, 'Email copied!', e.primary && emails.length > 1)),
        phones.map((ph) => contactItem(ph.label, ph.number, `tel:${ph.number.replace(/[^\d+]/g, '')}`, 'Phone number copied!', ph.primary && phones.length > 1))),
      p.links.length ? h('div', { class: 'socials' }, p.links.map((l) => h('a', { class: 'btn btn-sm', href: l.url, target: '_blank', rel: 'noopener me' }, l.label, icon('open')))) : null);
    sec.append(h('div', { class: 'contact-wrap' }, left, contactForm()));
    return sec;
  },
};

function contactItem(label, value, href, doneText, primary) {
  const btn = h('button', { class: 'copy-btn', type: 'button', 'aria-label': `Copy ${label.toLowerCase()} ${value}` }, icon('copy'), 'Copy');
  let timer;
  btn.addEventListener('click', async () => {
    const ok = await copyText(value);
    clearTimeout(timer);
    btn.classList.toggle('done', ok);
    btn.replaceChildren(icon(ok ? 'check' : 'copy'), ok ? doneText : 'Copy failed');
    toast(ok ? doneText : 'Copying is blocked in this browser. Select the text instead.');
    timer = setTimeout(() => { btn.classList.remove('done'); btn.replaceChildren(icon('copy'), 'Copy'); }, 2200);
  });
  return h('li', { class: 'contact-item' },
    h('div', { class: 'grow' },
      h('span', { class: 'lbl' }, label, primary ? h('span', { class: 'primary-badge', text: 'Primary' }) : null),
      h('a', { href, text: value })),
    btn);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

function contactForm() {
  const field = (id, label, type, extra = {}) => {
    const input = type === 'textarea'
      ? h('textarea', { id, name: id, required: extra.required, 'aria-describedby': `${id}-err`, maxlength: extra.max })
      : h('input', { id, name: id, type, required: extra.required, autocomplete: extra.ac, 'aria-describedby': `${id}-err`, maxlength: extra.max });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, h('p', { class: 'err', id: `${id}-err`, hidden: true }));
  };
  const status = h('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn btn-solid', type: 'submit', text: 'Send message' });
  const form = h('form', { class: 'frame form reveal', novalidate: true, 'aria-label': 'Contact form' },
    h('div', { class: 'row-2' }, field('name', 'Your name', 'text', { required: true, ac: 'name', max: 120 }), field('email', 'Your e-mail', 'email', { required: true, ac: 'email', max: 200 })),
    field('subject', 'Subject (optional)', 'text', { max: 200 }),
    field('message', 'Message', 'textarea', { required: true, max: 5000 }),
    h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { for: 'website', text: 'Leave empty' }), h('input', { id: 'website', name: 'website', tabindex: '-1', autocomplete: 'off' })),
    h('div', {}, submit), status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    form.querySelectorAll('.err').forEach((p) => { p.hidden = true; });
    form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
    status.className = 'form-status';
    status.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch(apiUrl('/api/public/contact'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) {
        form.reset();
        status.className = 'form-status ok';
        status.textContent = 'Message sent. I’ll reply to the e-mail you gave.';
      } else {
        let first = null;
        for (const [k, msg] of Object.entries(out.fields || {})) {
          const input = form.querySelector(`#${k}`);
          const err = form.querySelector(`#${k}-err`);
          if (input && err) { input.setAttribute('aria-invalid', 'true'); err.textContent = msg; err.hidden = false; first ||= input; }
        }
        first?.focus();
        status.className = 'form-status bad';
        status.textContent = out.error || 'Your message wasn’t sent. Try again.';
      }
    } catch {
      status.className = 'form-status bad';
      status.textContent = 'Your message wasn’t sent because the connection dropped. Try again.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send message';
    }
  });
  return form;
}

let toastTimer;
function toast(msg) {
  const t = $('.toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function observeReveals() {
  const els = document.querySelectorAll('.reveal:not(.is-in)');
  if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

addEventListener('scroll', () => $('.top').classList.toggle('scrolled', scrollY > 8), { passive: true });

load().catch(() => {
  $('.hero').hidden = true;
  const empty = $('.empty-state');
  empty.hidden = false;
  empty.querySelector('h1').textContent = "The portfolio couldn't load.";
  empty.querySelector('p').textContent = 'Refresh the page in a moment.';
});
