const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim();
const shouldIgnoreConfiguredUrl = !import.meta.env.DEV && /localhost|127\.0\.0\.1/.test(configuredApiUrl);
const API_URL = shouldIgnoreConfiguredUrl
  ? ''
  : (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:3001' : ''));

export async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

export function apiUrl(path) {
  return `${API_URL}${path}`;
}
