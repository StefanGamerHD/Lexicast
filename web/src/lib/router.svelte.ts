// Minimal history router: the current path as reactive state, navigate(), and same-origin link interception.
export const route = $state({ path: location.pathname, query: new URLSearchParams(location.search) });

function sync(): void {
  route.path = location.pathname;
  route.query = new URLSearchParams(location.search);
}

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  sync();
  window.scrollTo(0, 0);
}

// Only local paths are allowed as a return target after sign-in ("//host" would leave the site).
export function safeNext(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
}

export function startRouter(): void {
  window.addEventListener('popstate', sync);
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    // rel="external" marks server pages outside the app, e.g. /progress/{slug}
    if (!a || a.target || a.hasAttribute('download') || a.relList.contains('external') || a.origin !== location.origin) return;
    e.preventDefault();
    navigate(a.pathname + a.search);
  });
}
