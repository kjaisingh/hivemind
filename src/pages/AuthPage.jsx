import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiUrl } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const [isSignup, setIsSignup] = useState(true);
  const [form, setForm] = useState({ email: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const invite = useMemo(() => searchParams.get('invite') || '', [searchParams]);
  const next = useMemo(() => searchParams.get('next') || '/dashboard', [searchParams]);

  useEffect(() => {
    api('/api/public-config')
      .then((data) => setGoogleEnabled(Boolean(data.googleEnabled)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const path = isSignup ? '/api/auth/signup' : '/api/auth/login';
    const body = isSignup
      ? form
      : { email: form.email, password: form.password };

    try {
      const data = await api(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await refresh();

      if (invite || data.pendingInviteToken) {
        const inviteToken = invite || data.pendingInviteToken;
        const joined = await api(`/api/join/${inviteToken}`);
        if (!joined.requiresAuth) {
          navigate(`/games/${joined.gameId}`);
          return;
        }
      }

      navigate(next);
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  return (
    <div className="page auth-page">
      <div className="card auth-card">
        <h1>{isSignup ? 'Create account' : 'Welcome back'}</h1>
        <p>Use your username on all leaderboards. Keep it iconic.</p>

        <form className="stack" onSubmit={handleSubmit}>
          <input
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            required
          />

          {isSignup && (
            <input
              placeholder="Username (letters, numbers, underscore)"
              value={form.username}
              onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              required
            />
          )}

          <input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            required
          />

          <button className="button" type="submit">{isSignup ? 'Sign up' : 'Login'}</button>
        </form>

        {googleEnabled && (
          <a className="button button-secondary" href={apiUrl(`/api/auth/google${invite ? `?invite=${invite}` : ''}`)}>
            Continue with Google
          </a>
        )}

        {error && <p className="error">{error}</p>}

        <button className="link" onClick={() => setIsSignup((prev) => !prev)} type="button">
          {isSignup ? 'Already have an account? Login' : 'Need an account? Sign up'}
        </button>

        <Link className="link" to="/">Back to home</Link>
      </div>
    </div>
  );
}
