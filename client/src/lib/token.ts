const TOKEN_KEY = 'digi-deck:token';

// Read ?token=… from the URL, save it, and strip it from the address bar so
// it isn't accidentally shared via screenshot or back-button reload.
export function readUrlTokenAndStore(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return null;
  localStorage.setItem(TOKEN_KEY, token);
  url.searchParams.delete('token');
  const newQs = url.searchParams.toString();
  const clean = url.pathname + (newQs ? `?${newQs}` : '');
  window.history.replaceState({}, '', clean);
  return token;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
