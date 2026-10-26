// Profile image editor: crop to an aspect ratio, rotate, zoom, reposition
// (up/down/sideways), flip horizontally/vertically, with a live preview.
// Exports a new image and uploads it; the original file is untouched.
import { h, icon, btn, api, toast, errorText } from './ui.js';

const RATIOS = [
  ['original', 'Original'], ['1:1', 'Square 1:1'], ['4:5', 'Portrait 4:5'], ['3:4', 'Portrait 3:4'],
  ['2:3', 'Tall 2:3'], ['16:9', 'Wide 16:9'],
];
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export function openImageEditor({ src, onSaved }) {
  return new Promise((resolve) => {
    const st = { img: null, ratio: 'original', rot: 0, zoom: 1, x: 0, y: 0, flipH: false, flipV: false, format: 'image/webp' };
    const canvas = h('canvas', { class: 'ie-canvas', role: 'img', 'aria-label': 'Image preview' });
    const status = h('p', { class: 'hint', role: 'status' });
    const fileInput = h('input', { type: 'file', accept: ACCEPT.join(','), class: 'sr-only', id: 'ie-file' });

    const slider = (label, key, min, max, step, fmt) => {
      const out = h('output', { text: fmt(st[key]) });
      const input = h('input', { type: 'range', min, max, step, value: st[key], 'aria-label': label });
      input.addEventListener('input', () => { st[key] = Number(input.value); out.textContent = fmt(st[key]); draw(); });
      return { el: h('label', { class: 'ie-slider' }, h('span', { text: label }), input, out), input, out, key, fmt };
    };
    const sliders = [
      slider('Zoom', 'zoom', 1, 4, 0.01, (v) => `${Math.round(v * 100)}%`),
      slider('Rotate', 'rot', -180, 180, 1, (v) => `${v}°`),
      slider('Move sideways', 'x', -1, 1, 0.01, (v) => `${Math.round(v * 100)}`),
      slider('Move up / down', 'y', -1, 1, 0.01, (v) => `${Math.round(v * 100)}`),
    ];
    const sync = () => sliders.forEach((s) => { s.input.value = st[s.key]; s.out.textContent = s.fmt(st[s.key]); });

    const nudge = (dx, dy) => { st.x = clamp(st.x + dx, -1, 1); st.y = clamp(st.y + dy, -1, 1); sync(); draw(); };
    const ratioSel = h('select', { class: 'input', 'aria-label': 'Aspect ratio', onchange: (e) => { st.ratio = e.target.value; draw(); } },
      RATIOS.map(([v, l]) => h('option', { value: v, text: l })));
    const formatSel = h('select', { class: 'input', 'aria-label': 'Save as', onchange: (e) => { st.format = e.target.value; } },
      h('option', { value: 'image/webp', text: 'WebP (keeps transparency)' }),
      h('option', { value: 'image/png', text: 'PNG (keeps transparency)' }),
      h('option', { value: 'image/jpeg', text: 'JPG (white background)' }));

    const flipHBtn = h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': 'false', onclick: () => { st.flipH = !st.flipH; flipHBtn.setAttribute('aria-pressed', st.flipH); draw(); } }, icon('flipH'), 'Flip horizontal');
    const flipVBtn = h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': 'false', onclick: () => { st.flipV = !st.flipV; flipVBtn.setAttribute('aria-pressed', st.flipV); draw(); } }, icon('flipV'), 'Flip vertical');

    const saveBtn = btn('Save image', { kind: 'primary', iconName: 'check' });
    const dlg = h('dialog', { class: 'dialog dialog-wide', 'aria-labelledby': 'ie-title' },
      h('div', { class: 'dialog-head' }, h('h2', { id: 'ie-title', text: 'Edit profile image' }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close editor', onclick: () => close(null) }, icon('x'))),
      h('div', { class: 'ie' },
        h('div', { class: 'ie-stage' }, canvas, status),
        h('div', { class: 'ie-controls' },
          h('div', { class: 'ie-row' },
            h('label', { class: 'btn btn-sm', for: 'ie-file' }, icon('upload'), 'Choose image'), fileInput),
          h('p', { class: 'hint', text: 'JPG, PNG or WebP, up to 8 MB.' }),
          h('label', { class: 'field' }, h('span', { text: 'Aspect ratio' }), ratioSel),
          ...sliders.map((s) => s.el),
          h('div', { class: 'ie-row', role: 'group', 'aria-label': 'Rotate and flip' },
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Rotate left 90°', title: 'Rotate left 90°', onclick: () => { st.rot = wrap(st.rot - 90); sync(); draw(); } }, icon('rotL')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Rotate right 90°', title: 'Rotate right 90°', onclick: () => { st.rot = wrap(st.rot + 90); sync(); draw(); } }, icon('rotR')),
            flipHBtn, flipVBtn),
          h('div', { class: 'ie-pad', role: 'group', 'aria-label': 'Nudge position' },
            h('span'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move up', onclick: () => nudge(0, -0.05) }, icon('up')), h('span'),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move left', onclick: () => nudge(-0.05, 0) }, icon('left')),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { Object.assign(st, { rot: 0, zoom: 1, x: 0, y: 0, flipH: false, flipV: false }); flipHBtn.setAttribute('aria-pressed', 'false'); flipVBtn.setAttribute('aria-pressed', 'false'); sync(); draw(); } }, 'Reset'),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move right', onclick: () => nudge(0.05, 0) }, icon('right')),
            h('span'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move down', onclick: () => nudge(0, 0.05) }, icon('down')), h('span')),
          h('label', { class: 'field' }, h('span', { text: 'Save as' }), formatSel))),
      h('div', { class: 'dialog-actions' }, btn('Cancel', { onclick: () => close(null) }), saveBtn));

    document.body.append(dlg);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.showModal();

    function close(v) { dlg.close(); dlg.remove(); resolve(v); }

    function loadSrc(url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { st.img = img; status.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; draw(); };
      img.onerror = () => { status.textContent = "This image couldn't be opened. Choose another file."; };
      img.src = url;
    }

    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (!ACCEPT.includes(f.type)) { status.textContent = 'Use a JPG, PNG or WebP image.'; return; }
      if (f.size > 8 * 1024 * 1024) { status.textContent = 'That image is over 8 MB. Choose a smaller one.'; return; }
      loadSrc(URL.createObjectURL(f));
    });

    function outputSize() {
      const img = st.img;
      const rad = (st.rot * Math.PI) / 180;
      // Bounding box of the rotated image, used for "original".
      const bw = Math.abs(img.naturalWidth * Math.cos(rad)) + Math.abs(img.naturalHeight * Math.sin(rad));
      const bh = Math.abs(img.naturalWidth * Math.sin(rad)) + Math.abs(img.naturalHeight * Math.cos(rad));
      let r = bw / bh;
      if (st.ratio !== 'original') { const [a, b] = st.ratio.split(':').map(Number); r = a / b; }
      const long = Math.min(1400, Math.max(bw, bh));
      return r >= 1 ? [Math.round(long), Math.round(long / r)] : [Math.round(long * r), Math.round(long)];
    }

    function render(ctx, W, H, bgWhite) {
      const img = st.img;
      ctx.clearRect(0, 0, W, H);
      if (bgWhite) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); }
      const rad = (st.rot * Math.PI) / 180;
      const bw = Math.abs(img.naturalWidth * Math.cos(rad)) + Math.abs(img.naturalHeight * Math.sin(rad));
      const bh = Math.abs(img.naturalWidth * Math.sin(rad)) + Math.abs(img.naturalHeight * Math.cos(rad));
      const fit = Math.max(W / bw, H / bh); // cover the frame
      ctx.save();
      ctx.translate(W / 2 + (st.x * W) / 2, H / 2 + (st.y * H) / 2);
      ctx.rotate(rad);
      ctx.scale((st.flipH ? -1 : 1) * fit * st.zoom, (st.flipV ? -1 : 1) * fit * st.zoom);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
    }

    function draw() {
      if (!st.img) return;
      const [W, H] = outputSize();
      const scale = Math.min(1, 520 / Math.max(W, H));
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      render(canvas.getContext('2d'), canvas.width, canvas.height, false);
      status.textContent = `Output ${W} × ${H} px`;
    }

    saveBtn.addEventListener('click', async () => {
      if (!st.img) return;
      saveBtn.disabled = true;
      const [W, H] = outputSize();
      const out = h('canvas', { width: W, height: H });
      render(out.getContext('2d'), W, H, st.format === 'image/jpeg');
      try {
        const blob = await new Promise((r) => out.toBlob(r, st.format, 0.9));
        if (!blob) throw new Error("Your browser couldn't export this format. Pick another one.");
        const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[st.format];
        const fd = new FormData();
        fd.append('file', blob, `profile-image.${ext}`);
        const res = await api('/api/admin/upload?kind=image', { method: 'POST', body: fd });
        toast('Image saved. Save the profile to publish it.');
        onSaved?.(res);
        close(res);
      } catch (e) {
        toast(errorText(e), 'bad');
        saveBtn.disabled = false;
      }
    });

    if (src) loadSrc(src);
    else status.textContent = 'Choose an image to start.';
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
