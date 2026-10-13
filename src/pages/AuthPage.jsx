import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/auth';

export default function AuthPage() {
  const [isSignup, setIsSignup] = useState(true);
  const [form, setForm] = useState({ email: '', username: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const invite = useMemo(() => searchParams.get('invite') || '', [searchParams]);
  const next = useMemo(() => {
    const requested = searchParams.get('next') || '/dashboard';
    return requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard';
  }, [searchParams]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    if (isSignup && form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      setSubmitting(false);
      return;
    }

    if (new TextEncoder().encode(form.password).length > 72) {
      setError('Password must be 72 bytes or fewer.');
      setSubmitting(false);
      return;
    }

    const path = isSignup ? '/api/auth/signup' : '/api/auth/login';
    const body = isSignup
      ? { email: form.email, username: form.username, password: form.password }
      : { email: form.email, password: form.password };

    try {
      const data = await api(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await refresh();

      if (invite || data.pendingInviteToken) {
        const inviteToken = invite || data.pendingInviteToken;
        const joined = await api(`/api/join/${encodeURIComponent(inviteToken)}`);
        if (!joined.requiresAuth) {
          navigate(`/games/${joined.gameId}`);
          return;
        }
      }

      navigate(next);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page auth-page">
      <div className="card auth-card">
        <h1>{isSignup ? 'Create account' : 'Welcome back'}</h1>
        <p>Use your username on all leaderboards. Keep it iconic.</p>

        <form className="stack" onSubmit={handleSubmit}>
          <label className="field stack-xs">
            <span>Email</span>
            <input
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>

          {isSignup && (
            <label className="field stack-xs">
              <span>Username</span>
              <input
                placeholder="Letters, numbers, and underscores"
                autoComplete="username"
                minLength={3}
                maxLength={24}
                value={form.username}
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                required
              />
            </label>
          )}

          <label className="field stack-xs">
            <span>Password</span>
            <input
              placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              minLength={isSignup ? 8 : 1}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              required
            />
          </label>

          {isSignup && (
            <label className="field stack-xs">
              <span>Confirm password</span>
              <input
                placeholder="Repeat your password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={form.confirmPassword}
                onChange={(event) => setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                required
              />
            </label>
          )}

          <button className="button" type="submit" disabled={submitting}>
            {submitting ? 'Please wait...' : isSignup ? 'Sign up' : 'Login'}
          </button>
        </form>

        {error && <p className="error" role="alert">{error}</p>}

        <button className="link" onClick={() => setIsSignup((prev) => !prev)} type="button">
          {isSignup ? 'Already have an account? Login' : 'Need an account? Sign up'}
        </button>

        <Link className="link" to="/">Back to home</Link>
      </div>
    </main>
  );
}
