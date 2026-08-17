/** Match Frappe web page route (/caratdesk-pos) and Vite dev route (/pos). */
export function getRouterBasename() {
  const path = window.location.pathname.replace(/\/$/, '') || '';
  if (path === '/caratdesk-pos' || path.startsWith('/caratdesk-pos/')) {
    return '/caratdesk-pos';
  }
  if (path === '/pos' || path.startsWith('/pos/')) {
    return '/pos';
  }
  return '/';
}
