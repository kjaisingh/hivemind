import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function JoinPage() {
  const { inviteToken } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('Joining game...');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setFailed(false);
    setMessage('Joining game...');
    async function join() {
      try {
        const data = await api(`/api/join/${encodeURIComponent(inviteToken)}`, { signal: controller.signal });
        if (!active) return;
        if (data.requiresAuth) {
          navigate(`/auth?invite=${encodeURIComponent(inviteToken)}`);
          return;
        }
        navigate(`/games/${data.gameId}`);
      } catch (error) {
        if (!active) return;
        setMessage(error.message);
        setFailed(true);
      }
    }

    join();
    return () => { active = false; controller.abort(); };
  }, [inviteToken, navigate, retry]);

  return (
    <main className="page">
      <div className="card stack">
        <p className={failed ? 'error' : undefined} role={failed ? 'alert' : 'status'}>{message}</p>
        {failed && <button className="button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>}
        {failed && <Link className="button button-secondary" to="/dashboard">Back to dashboard</Link>}
      </div>
    </main>
  );
}
