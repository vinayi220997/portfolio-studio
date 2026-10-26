// Theme engine shared by the site and the admin.
const STORAGE = 'ps-theme';

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a, b) {
  const la = luminance(hexToRgb(a)), lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Picks white or near-black text for a filled accent button.
export function onAccent(accent) {
  if (!hexToRgb(accent)) return '#FFFFFF';
  return contrast(accent, '#FFFFFF') >= contrast(accent, '#111317') ? '#FFFFFF' : '#111317';
}

export function resolveMode(mode) {
  if (mode === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return ['light', 'dark', 'browser'].includes(mode) ? mode : 'light';
}

// Applies a theme object: { mode, accent, background: { type, solid, gradient } }.
// `overrideMode` lets a visitor (or admin) pick their own light/dark choice.
// Light or dark text for a custom background, from its average luminance.
export function modeForBackground(bg) {
  const cols = bg.type === 'solid' ? [bg.solid] : [bg.gradient?.from, bg.gradient?.to];
  const rgbs = cols.map(hexToRgb).filter(Boolean);
  if (!rgbs.length) return null;
  const lum = rgbs.reduce((a, c) => a + luminance(c), 0) / rgbs.length;
  // Pick whichever of near-black / white text contrasts more.
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? 'light' : 'dark';
}

export function applyTheme(theme, { overrideMode = null, target = document.documentElement, persist = true } = {}) {
  if (!theme) return;
  const bgIn = theme.background || {};
  let mode = resolveMode(overrideMode || theme.mode);
  let bgType = bgIn.type || 'canvas';
  if (bgType !== 'canvas' && mode !== 'browser') {
    // A custom background decides light/dark text so it stays readable.
    // If someone picks their own mode, fall back to the dotted canvas instead.
    if (overrideMode) bgType = 'canvas';
    else mode = modeForBackground(bgIn) || mode;
  }
  target.dataset.theme = mode;
  if (mode === 'browser') {
    target.style.removeProperty('--accent');
    target.style.removeProperty('--on-accent');
  } else {
    target.style.setProperty('--accent', theme.accent);
    target.style.setProperty('--on-accent', onAccent(theme.accent));
  }
  const bg = bgIn;
  target.dataset.bg = mode === 'browser' ? 'canvas' : bgType;
  target.style.setProperty('--bg-solid', bg.solid || '');
  const g = bg.gradient || {};
  target.style.setProperty('--bg-from', g.from || '');
  target.style.setProperty('--bg-to', g.to || '');
  target.style.setProperty('--bg-angle', (g.angle ?? 135) + 'deg');
  target.dataset.bgAnimate = g.animate ? 'on' : 'off';
  if (persist) {
    try { localStorage.setItem(STORAGE, JSON.stringify(theme)); } catch { /* storage blocked */ }
  }
}

// Re-apply when the OS switches light/dark while mode is "system".
export function watchSystem(getTheme, getOverride) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', () => {
    const t = getTheme();
    const o = getOverride();
    if ((o || t?.mode) === 'system') applyTheme(t, { overrideMode: o });
  });
}
