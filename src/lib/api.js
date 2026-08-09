const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim();
const shouldIgnoreConfiguredUrl = !import.meta.env.DEV && /localhost|127\.0\.0\.1/.test(configuredApiUrl);
const API_URL = shouldIgnoreConfiguredUrl
  ? ''
  : (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:3001' : ''));

export async function api(path, { timeoutMs = 15000, ...options } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

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
