// Runs before first paint so there is no flash of the wrong theme.
// Uses the last theme the server sent (cached) plus any visitor override.
(function () {
  var root = document.documentElement;
  var t = null;
  try { t = JSON.parse(localStorage.getItem('ps-theme') || 'null'); } catch (e) {}
  var override = null;
  try { override = localStorage.getItem(root.dataset.scope === 'admin' ? 'ps-admin-mode' : 'ps-visitor-mode'); } catch (e) {}
  var mode = override || (t && t.mode) || 'system';
  if (mode === 'system') mode = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = mode;
  if (t && t.accent && mode !== 'browser') root.style.setProperty('--accent', t.accent);
})();
