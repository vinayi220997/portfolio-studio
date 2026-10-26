// Profile editor: every editable part of one profile, saved as a whole.
import { h, icon, btn, iconBtn, api, toast, confirmDialog, errorText, field, toggle, fmtDate } from './ui.js';
import { openImageEditor } from './image-editor.js';

const uid = (p) => p + Math.random().toString(36).slice(2, 11);

// Field definitions for each repeatable section.
const CARDS = {
  projects: {
    label: 'Projects', one: 'project', prefix: 'pr_', title: (c) => c.title || 'Untitled project',
    sub: (c) => [c.role, c.year].filter(Boolean).join(', '),
    fields: [
      ['title', 'Title', 'text'], ['role', 'Your role', 'text'], ['year', 'Year', 'text'],
      ['summary', 'Summary', 'textarea'], ['tags', 'Tags', 'list', 'Separate with commas.'],
      ['image', 'Cover image', 'image'], ['link', 'Case study or project link', 'url'], ['linkLabel', 'Link text', 'text', 'For example: Read the case study'],
    ],
  },
  experience: {
    label: 'Experience', one: 'role', prefix: 'ex_', title: (c) => c.role || 'Untitled role', sub: (c) => [c.company, [c.start, c.end].filter(Boolean).join(' – ')].filter(Boolean).join(', '),
    fields: [['role', 'Job title', 'text'], ['company', 'Company', 'text'], ['location', 'Location', 'text'], ['start', 'Start', 'text', 'For example: Jan 2025'], ['end', 'End', 'text', 'For example: Present'], ['points', 'Highlights', 'lines', 'One per line.']],
  },
  education: {
    label: 'Education', one: 'entry', prefix: 'ed_', title: (c) => c.degree || c.school || 'Untitled', sub: (c) => c.school,
    fields: [['degree', 'Degree', 'text'], ['field', 'Field of study', 'text'], ['school', 'School', 'text'], ['start', 'Start', 'text'], ['end', 'End', 'text']],
  },
  certifications: {
    label: 'Certifications', one: 'certification', prefix: 'ce_', title: (c) => c.name || 'Untitled', sub: (c) => [c.issuer, c.year].filter(Boolean).join(', '),
    fields: [['name', 'Name', 'text'], ['issuer', 'Issuer', 'text'], ['year', 'Year', 'text'], ['link', 'Credential link', 'url']],
  },
  skills: {
    label: 'Skills', one: 'skill', prefix: 'sk_', title: (c) => c.name || 'Untitled skill', sub: (c) => (c.tools || []).slice(0, 3).join(', '),
    fields: [['name', 'Skill', 'text'], ['summary', 'Description', 'textarea'], ['tools', 'Tools and methods', 'list', 'Separate with commas.']],
  },
  links: {
    label: 'Links', one: 'link', prefix: 'l_', title: (c) => c.label || 'Untitled link', sub: (c) => c.url,
    fields: [['label', 'Label', 'text', 'For example: LinkedIn'], ['url', 'Address', 'url']],
  },
};

const TABS = [
  ['basics', 'Basics'], ['brand', 'Logo & image'], ['contact', 'Contact'], ['resume', 'Resume'], ['sections', 'Sections'],
  ['projects', 'Projects'], ['experience', 'Experience'], ['skills', 'Skills'], ['education', 'Education'], ['certifications', 'Certifications'], ['links', 'Links'],
];

export async function profileEditor(root, id, { onDirty }) {
  let rec;
  try {
    rec = await api(`/api/admin/profiles/${id}`);
  } catch (e) {
    root.replaceChildren(h('p', { class: 'empty', text: errorText(e) }));
    return;
  }
  const state = structuredClone(rec.data);
  let name = rec.name;
  let tab = sessionStorage.getItem('ps-tab') || 'basics';
  let dirty = false;
  const markDirty = () => {
    if (!dirty) { dirty = true; saveBar.classList.add('dirty'); onDirty(true); }
    saveState.textContent = 'Unsaved changes';
  };

  // ---------- header ----------
  const nameInput = h('input', { class: 'input input-title', value: name, 'aria-label': 'Profile name (only you see this)', maxlength: 80, oninput: (e) => { name = e.target.value; markDirty(); } });
  const statusBadge = h('span', { class: `badge badge-${rec.status}`, text: label(rec.status) });
  const saveState = h('span', { class: 'save-state', text: `Saved ${fmtDate(rec.updated_at)}` });
  const saveBtn = btn('Save changes', { kind: 'primary', iconName: 'check', onclick: save });
  const errorsBox = h('div', { class: 'callout callout-bad', role: 'alert', hidden: true });
  const saveBar = h('div', { class: 'save-bar' }, saveState, h('a', { class: 'btn btn-sm', href: '/', target: '_blank', rel: 'noopener' }, icon('ext'), 'View site'), saveBtn);

  const tabList = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Profile parts' });
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel', tabindex: '-1' });

  root.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', {}, h('a', { class: 'back', href: '#/profiles' }, icon('left'), 'All profiles'),
        h('div', { class: 'title-row' }, nameInput, statusBadge)),
      saveBar),
    errorsBox, tabList, panel);

  function drawTabs() {
    tabList.replaceChildren(...TABS.map(([k, l]) => {
      const count = CARDS[k] ? ` (${(state[k] || []).length})` : '';
      return h('button', {
        class: 'tab', role: 'tab', type: 'button', id: `tab-${k}`, 'aria-selected': String(tab === k), 'aria-controls': 'panel', tabindex: tab === k ? '0' : '-1',
        onclick: () => { tab = k; sessionStorage.setItem('ps-tab', k); drawTabs(); drawPanel(); },
        onkeydown: (e) => {
          const i = TABS.findIndex(([x]) => x === tab);
          const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
          if (n === null) return;
          tab = TABS[(n + TABS.length) % TABS.length][0];
          drawTabs(); drawPanel();
          tabList.querySelector('[aria-selected=true]').focus();
        },
      }, l + count);
    }));
  }

  function drawPanel() {
    panel.id = 'panel';
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
    const view = { basics, brand, contact, resume, sections }[tab];
    panel.replaceChildren(view ? view() : cardsView(tab));
  }

  // ---------- inputs bound to state ----------
  function text(obj, key, attrs = {}) {
    const el = attrs.multiline
      ? h('textarea', { class: 'input', rows: attrs.rows || 4, maxlength: attrs.max })
      : h('input', { class: 'input', type: attrs.type || 'text', maxlength: attrs.max, placeholder: attrs.placeholder, inputmode: attrs.inputmode });
    el.value = obj[key] ?? '';
    el.addEventListener('input', () => { obj[key] = el.value; markDirty(); attrs.after?.(); });
    return el;
  }

  // ---------- Basics ----------
  function basics() {
    const demo = h('p', { class: 'typing-demo', 'aria-live': 'off' });
    const renderDemo = () => {
      const t = state.titles.split(',').map((x) => x.trim()).filter(Boolean);
      demo.replaceChildren(...(state.typing && t.length > 1
        ? [h('span', { text: t[0] }), h('span', { class: 'caret' }), h('small', { text: `  then types: ${t.slice(1).join(', ')}` })]
        : t.flatMap((x, i) => (i ? [h('span', { class: 'sep' }), x] : [x]))));
    };
    renderDemo();
    return h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('h2', { text: 'Identity' }),
        h('div', { class: 'grid-2' },
          field('Display name', text(state, 'displayName', { max: 80 })),
          field('Location', text(state, 'location', { max: 80 }))),
        field('Professional titles', text(state, 'titles', { max: 300, after: renderDemo }), 'Separate titles with commas, for example: UI/UX Designer, Visual Designer.'),
        toggle('Typing animation', state.typing, (v) => { state.typing = v; markDirty(); renderDemo(); }, 'Types each title letter by letter, pauses, erases and moves to the next. Off shows them side by side. Visitors who prefer reduced motion always see them side by side.'),
        h('div', { class: 'preview-box' }, h('span', { class: 'preview-label', text: 'Preview' }), demo),
        field('Short introduction', text(state, 'intro', { multiline: true, rows: 3, max: 400 }), 'Shown under your titles at the top of the page.'),
        field('Availability (optional)', text(state, 'availability', { max: 120 }), 'For example: Open to full-time UI/UX roles. Leave empty to hide.')),
      h('section', { class: 'card' }, h('h2', { text: 'About' }),
        field('About text', text(state, 'about', { multiline: true, rows: 7, max: 3000 }))));
  }

  // ---------- Logo & image ----------
  function brand() {
    const marks = h('div', { class: 'mark-previews' });
    const drawMarks = () => {
      const letters = state.logo.letters || '?';
      marks.replaceChildren(
        ...[56, 34, 18].map((s) => h('span', { class: 'mark', 'data-shape': state.logo.shape, style: `width:${s}px;height:${s}px;font-size:${s * (letters.length > 2 ? .3 : .38)}px`, text: letters })),
        h('span', { class: 'hint', text: 'Header, and browser tab icon (favicon) after you save and publish.' }));
    };
    drawMarks();
    const letters = text(state.logo, 'letters', { max: 3, after: drawMarks });
    const shapes = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Logo shape' }, ['rounded', 'circle', 'square'].map((s) =>
      h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'shape', value: s, checked: state.logo.shape === s, onchange: () => { state.logo.shape = s; markDirty(); drawMarks(); } }), h('span', { text: cap(s) }))));

    const avatarPreview = h('div', { class: 'avatar-preview' });
    const imgSrc = () => (state.avatar.fileId ? `/files/${state.avatar.fileId}` : state.avatar.src);
    const drawAvatar = () => {
      const src = imgSrc();
      avatarPreview.dataset.style = state.avatar.style;
      avatarPreview.replaceChildren(src ? h('img', { src, alt: state.avatar.alt || 'Profile image preview' }) : h('div', { class: 'initials', text: state.logo.letters }));
    };
    drawAvatar();
    const styles = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Image style' }, [['cutout', 'Seated cut-out'], ['frameless', 'Frameless fade'], ['layered', 'Layered shape']].map(([v, l]) =>
      h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'astyle', value: v, checked: state.avatar.style === v, onchange: () => { state.avatar.style = v; markDirty(); drawAvatar(); } }), h('span', { text: l }))));
    const edit = async (useCurrent) => {
      const res = await openImageEditor({ src: useCurrent ? imgSrc() : null });
      if (res) { state.avatar.fileId = res.id; state.avatar.src = ''; markDirty(); drawAvatar(); }
    };
    return h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('h2', { text: 'Logo letters' }),
        h('div', { class: 'grid-2' }, field('Letters (up to 3)', letters, 'Usually your initials.'), h('div', { class: 'field' }, h('span', { class: 'label', text: 'Shape' }), shapes)),
        marks),
      h('section', { class: 'card' }, h('h2', { text: 'Profile image' }),
        h('div', { class: 'avatar-editor' }, avatarPreview,
          h('div', { class: 'stack-sm' },
            h('div', { class: 'row' },
              btn('Edit this image', { iconName: 'edit', onclick: () => edit(true), disabled: !imgSrc() }),
              btn('Upload a new image', { iconName: 'upload', onclick: () => edit(false) })),
            h('p', { class: 'hint', text: 'Crop, rotate, move and flip in the editor. The edited copy is saved; your original file is not changed.' }),
            h('div', { class: 'field' }, h('span', { class: 'label', text: 'Style on the site' }), styles),
            field('Image description (alt text)', text(state.avatar, 'alt', { max: 200 }), 'Describe the image for people using screen readers.'),
            state.avatar.fileId ? btn('Go back to the default image', { small: true, onclick: () => { state.avatar.fileId = ''; state.avatar.src = '/assets/avatar.webp'; markDirty(); drawPanel(); } }) : null))));
  }

  // ---------- Contact ----------
  function contactList(key, valueKey, valueLabel, inputType, placeholder) {
    const list = state[key];
    const wrap = h('div', { class: 'stack-sm' });
    const draw = () => {
      wrap.replaceChildren(
        ...list.map((item, i) => h('div', { class: 'contact-row' },
          field('Label', text(item, 'label', { max: 40 })),
          field(valueLabel, text(item, valueKey, { type: inputType, max: 200, placeholder, inputmode: inputType === 'tel' ? 'tel' : undefined })),
          h('label', { class: 'radio-pill' }, h('input', { type: 'radio', name: `${key}-primary`, checked: item.primary, onchange: () => { list.forEach((x) => { x.primary = x === item; }); markDirty(); } }), h('span', { text: 'Primary' })),
          toggle('Show on site', item.visible, (v) => { item.visible = v; markDirty(); }),
          iconBtn('trash', `Remove ${item[valueKey] || 'this entry'}`, () => { list.splice(i, 1); if (list.length && !list.some((x) => x.primary)) list[0].primary = true; markDirty(); draw(); }, { danger: true }))),
        list.length ? null : h('p', { class: 'hint', text: `No ${key} yet.` }),
        btn(`Add ${key === 'emails' ? 'e-mail' : 'phone number'}`, { iconName: 'plus', small: true, onclick: () => { list.push({ id: uid(key[0] + '_'), label: key === 'emails' ? 'Email' : 'Phone', [valueKey]: '', primary: list.length === 0, visible: true }); markDirty(); draw(); wrap.querySelector('.contact-row:last-of-type input:not([type=radio])')?.focus(); } }));
    };
    draw();
    return wrap;
  }
  function contact() {
    return h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('h2', { text: 'E-mail addresses' }), h('p', { class: 'hint', text: 'Visitors see the addresses marked "Show on site", primary first, each with a Copy button. The contact form saves messages to your inbox here.' }),
        contactList('emails', 'address', 'Address', 'email', 'name@example.com')),
      h('section', { class: 'card' }, h('h2', { text: 'Phone numbers' }),
        contactList('phones', 'number', 'Number', 'tel', '+91 …')));
  }

  // ---------- Resume ----------
  function resume() {
    const r = state.resume;
    const fileInfo = h('p', { class: 'hint' });
    const drawInfo = () => { fileInfo.textContent = r.fileId ? `Uploaded: ${r.fileName || 'resume.pdf'}` : 'No file uploaded yet.'; };
    drawInfo();
    const upInput = h('input', { type: 'file', accept: 'application/pdf', class: 'sr-only', id: 'resume-file' });
    upInput.addEventListener('change', async () => {
      const f = upInput.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      try {
        const res = await api('/api/admin/upload?kind=resume', { method: 'POST', body: fd });
        r.fileId = res.id; r.fileName = res.name; r.mode = 'file';
        markDirty(); drawPanel(); toast('Resume uploaded. Save the profile to publish it.');
      } catch (e) { toast(errorText(e), 'bad'); }
    });
    const modeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Resume source' }, [['file', 'Upload a PDF'], ['url', 'Link to a file']].map(([v, l]) =>
      h('label', { class: 'seg-opt' }, h('input', { type: 'radio', name: 'rmode', checked: r.mode === v, onchange: () => { r.mode = v; markDirty(); drawPanel(); } }), h('span', { text: l }))));
    const href = r.mode === 'file' ? (r.fileId ? `/files/${r.fileId}` : '') : r.url;
    return h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('h2', { text: 'Resume' }),
        h('div', { class: 'field' }, h('span', { class: 'label', text: 'Source' }), modeSeg),
        r.mode === 'file'
          ? h('div', { class: 'stack-sm' }, h('div', { class: 'row' }, h('label', { class: 'btn', for: 'resume-file' }, icon('upload'), r.fileId ? 'Replace PDF' : 'Upload PDF'), upInput), fileInfo)
          : field('Link to your resume', text(r, 'url', { type: 'url', placeholder: 'https://drive.google.com/…' }), 'Google Drive, Dropbox or any public https:// link.'),
        field('Button label', text(r, 'label', { max: 40 })),
        h('div', { class: 'stack-sm' },
          toggle('Show "Download" button', r.showDownload, (v) => { r.showDownload = v; markDirty(); }),
          toggle('Show "Open in new tab" button', r.showOpen, (v) => { r.showOpen = v; markDirty(); }),
          toggle('Show "Preview" button', r.showPreview, (v) => { r.showPreview = v; markDirty(); })),
        href ? h('div', { class: 'row' }, btn('Preview resume', { iconName: 'eye', onclick: () => previewDialog(href) }), h('a', { class: 'btn', href, target: '_blank', rel: 'noopener' }, icon('ext'), 'Open in new tab')) : h('p', { class: 'hint', text: 'Add a file or link to show resume buttons on the site.' })));
  }

  // ---------- Sections ----------
  function sections() {
    const wrap = h('ol', { class: 'section-list' });
    const draw = () => {
      wrap.replaceChildren(...state.sections.map((s, i) => h('li', { class: 'section-row' },
        h('span', { class: 'key', text: s.key }),
        text(s, 'title', { max: 60 }),
        toggle('Visible', s.visible, (v) => { s.visible = v; markDirty(); }),
        h('div', { class: 'row-tight' },
          iconBtn('up', `Move ${s.title} up`, () => { move(state.sections, i, -1); markDirty(); draw(); }, { disabled: i === 0 }),
          iconBtn('down', `Move ${s.title} down`, () => { move(state.sections, i, 1); markDirty(); draw(); }, { disabled: i === state.sections.length - 1 })))));
      wrap.querySelectorAll('.section-row > input').forEach((el, i) => el.setAttribute('aria-label', `Title for the ${state.sections[i].key} section`));
    };
    draw();
    return h('section', { class: 'card' }, h('h2', { text: 'Sections' }), h('p', { class: 'hint', text: 'Rename, reorder or hide sections. Empty sections are hidden on the site automatically.' }), wrap);
  }

  // ---------- Repeatable cards ----------
  function cardsView(key) {
    const def = CARDS[key];
    const list = state[key];
    const wrap = h('div', { class: 'stack-sm' });
    const open = new Set();
    const draw = (focusId) => {
      wrap.replaceChildren(
        h('div', { class: 'row space' },
          h('p', { class: 'hint', text: `${list.filter((c) => c.published).length} published, ${list.filter((c) => !c.published).length} draft. Drafts stay hidden from visitors.` }),
          btn(`Add ${def.one}`, { kind: 'primary', small: true, iconName: 'plus', onclick: () => { const c = blank(key); list.push(c); open.add(c.id); markDirty(); draw(c.id); drawTabs(); } })),
        list.length ? null : h('p', { class: 'empty', text: `No ${def.label.toLowerCase()} yet. Add your first ${def.one}.` }),
        ...list.map((c, i) => {
          const det = h('details', { class: 'item', open: open.has(c.id), ontoggle: (e) => (e.target.open ? open.add(c.id) : open.delete(c.id)) });
          const titleEl = h('span', { class: 'item-title', text: def.title(c) });
          const subEl = h('span', { class: 'item-sub', text: def.sub(c) || '' });
          det.append(
            h('summary', {}, icon('right', 'ico chev'), h('span', { class: 'item-head' }, titleEl, subEl), h('span', { class: `badge badge-${c.published ? 'published' : 'draft'}`, text: c.published ? 'Published' : 'Draft' })),
            h('div', { class: 'item-body' },
              h('div', { class: 'grid-2' }, def.fields.map(([k, l, type, hint]) => cardField(c, k, l, type, hint, () => { titleEl.textContent = def.title(c); subEl.textContent = def.sub(c) || ''; }))),
              h('div', { class: 'item-actions' },
                toggle('Published', c.published, (v) => { c.published = v; markDirty(); draw(c.id); }),
                h('div', { class: 'row-tight' },
                  btn('Duplicate', { small: true, iconName: 'copy', onclick: () => { const copy = structuredClone(c); copy.id = uid(def.prefix); copy.published = false; for (const t of ['title', 'name', 'role', 'label', 'degree']) if (copy[t]) { copy[t] += ' (copy)'; break; } list.splice(i + 1, 0, copy); open.add(copy.id); markDirty(); draw(copy.id); drawTabs(); toast('Copied as a draft.'); } }),
                  iconBtn('up', 'Move up', () => { move(list, i, -1); markDirty(); draw(); }, { disabled: i === 0 }),
                  iconBtn('down', 'Move down', () => { move(list, i, 1); markDirty(); draw(); }, { disabled: i === list.length - 1 }),
                  btn('Delete', { small: true, kind: 'danger-ghost', iconName: 'trash', onclick: async () => {
                    if (await confirmDialog({ title: `Delete "${def.title(c)}"?`, body: 'This removes it from this profile when you save. Unsaved deletions can be undone by leaving without saving.', confirmLabel: 'Delete', danger: true })) {
                      list.splice(i, 1); markDirty(); draw(); drawTabs();
                    }
                  } })))));
          return det;
        }));
      if (focusId) wrap.querySelector(`details[open] .item-body input`)?.focus();
    };
    draw();
    return h('section', { class: 'card' }, h('h2', { text: def.label }), wrap);
  }

  function cardField(c, k, l, type, hint, after) {
    if (type === 'image') {
      const prev = h('div', { class: 'thumb' });
      const drawPrev = () => {
        const src = c.imageFileId ? `/files/${c.imageFileId}` : c.imageUrl;
        prev.replaceChildren(src ? h('img', { src, alt: '' }) : h('span', { text: 'No image' }));
      };
      drawPrev();
      const fid = 'f_' + c.id;
      const inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: fid });
      inp.addEventListener('change', async () => {
        const f = inp.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        try {
          const res = await api('/api/admin/upload?kind=image', { method: 'POST', body: fd });
          c.imageFileId = res.id; c.imageUrl = ''; markDirty(); drawPrev();
        } catch (e) { toast(errorText(e), 'bad'); }
      });
      return h('div', { class: 'field span-2' }, h('span', { class: 'label', text: l }),
        h('div', { class: 'row' }, prev, h('div', { class: 'stack-sm grow' },
          h('div', { class: 'row' }, h('label', { class: 'btn btn-sm', for: fid }, icon('upload'), 'Upload image'), inp,
            c.imageFileId || c.imageUrl ? btn('Remove', { small: true, onclick: () => { c.imageFileId = ''; c.imageUrl = ''; markDirty(); drawPrev(); } }) : null),
          field('…or image address', text(c, 'imageUrl', { type: 'url', placeholder: 'https://…', after: drawPrev })))),
        h('p', { class: 'hint', text: 'Without an image, the site shows a cover built from the project initials.' }));
    }
    let control;
    if (type === 'textarea') control = text(c, k, { multiline: true, rows: 3, max: 2000, after });
    else if (type === 'list' || type === 'lines') {
      control = h(type === 'lines' ? 'textarea' : 'input', { class: 'input', rows: 4 });
      control.value = (c[k] || []).join(type === 'lines' ? '\n' : ', ');
      control.addEventListener('input', () => { c[k] = control.value.split(type === 'lines' ? '\n' : ',').map((x) => x.trim()).filter(Boolean); markDirty(); after(); });
    } else control = text(c, k, { type: type === 'url' ? 'url' : 'text', max: 200, after, placeholder: type === 'url' ? 'https://…' : undefined });
    const f = field(l, control, hint);
    if (['textarea', 'lines'].includes(type) || k === 'title' || k === 'name') f.classList.add('span-2');
    return f;
  }

  function blank(key) {
    const def = CARDS[key];
    const c = { id: uid(def.prefix), published: false };
    for (const [k, , type] of def.fields) {
      if (type === 'image') { c.imageFileId = ''; c.imageUrl = ''; } else c[k] = type === 'list' || type === 'lines' ? [] : '';
    }
    return c;
  }

  // ---------- save ----------
  async function save() {
    saveBtn.disabled = true;
    errorsBox.hidden = true;
    try {
      const out = await api(`/api/admin/profiles/${id}`, { method: 'PUT', body: { name, data: state } });
      Object.assign(state, out.data);
      dirty = false;
      saveBar.classList.remove('dirty');
      onDirty(false);
      saveState.textContent = `Saved ${fmtDate(out.updated_at)}`;
      toast(out.status === 'published' ? 'Saved. The live site is updated.' : 'Saved as a draft.');
    } catch (e) {
      errorsBox.replaceChildren(h('strong', { text: e.message }), e.body?.details ? h('ul', {}, e.body.details.map((d) => h('li', { text: d }))) : null);
      errorsBox.hidden = false;
      errorsBox.scrollIntoView({ block: 'nearest' });
      toast(e.message, 'bad');
    } finally {
      saveBtn.disabled = false;
    }
  }

  // Ctrl/Cmd+S saves.
  root.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };

  drawTabs();
  drawPanel();
}

export function previewDialog(href) {
  const dlg = h('dialog', { class: 'dialog dialog-wide dialog-tall', 'aria-label': 'Resume preview' },
    h('div', { class: 'dialog-head' }, h('h2', { text: 'Resume preview' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close preview', onclick: () => { dlg.close(); dlg.remove(); } }, icon('x'))),
    h('iframe', { class: 'preview-frame', title: 'Resume preview', src: href.replace(/drive\.google\.com\/file\/d\/([^/]+)\/view.*/, 'drive.google.com/file/d/$1/preview') }));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function move(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const label = (s) => ({ published: 'Published', draft: 'Draft', hidden: 'Hidden' }[s] || s);
