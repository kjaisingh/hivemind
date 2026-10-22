const environment = import.meta.env || {};
const configuredApiUrl = (environment.VITE_API_URL || '').trim();
const shouldIgnoreConfiguredUrl = !environment.DEV && /localhost|127\.0\.0\.1/.test(configuredApiUrl);
const API_URL = shouldIgnoreConfiguredUrl
  ? ''
  : (configuredApiUrl || (environment.DEV ? 'http://localhost:3001' : ''));

export async function api(path, { timeoutMs = 15000, headers, signal, ...options } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    let data = null;
    if (contentType.includes('application/json')) {
      try { data = JSON.parse(body); } catch { /* Report invalid responses below. */ }
    }
    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('hivemind-session-expired'));
      }
      const message = data?.message || (!body.trimStart().startsWith('<') && !contentType.includes('application/json') ? body : '');
      const error = new Error(message || `Request failed (${response.status}). Please try again.`);
      error.status = response.status;
      throw error;
    }
    if (data === null) throw new Error('The server returned an invalid response. Please try again.');
    return data;
  } catch (err) {
    if (controller.signal.aborted) throw new Error('Request timed out. Please try again.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function apiUrl(path) {
  return `${API_URL}${path}`;
}
