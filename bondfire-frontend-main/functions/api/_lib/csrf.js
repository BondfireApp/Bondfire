import { bad } from './http.js';
export function requireCookieCsrf(request) {
  if (/^Bearer\s+\S+/i.test(request.headers.get('authorization') || '')) return null;
  const cookie = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('bf_csrf='));
  let value = '';
  try { value = cookie ? decodeURIComponent(cookie.slice(8)) : ''; } catch {}
  if (!value || value !== request.headers.get('x-csrf')) return bad(403, 'CSRF_REQUIRED');
  return null;
}
