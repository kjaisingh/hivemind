import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function JoinPage() {
  const { inviteToken } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('Joining game...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    async function join() {
      try {
        const data = await api(`/api/join/${inviteToken}`);
        if (data.requiresAuth) {
          navigate(`/auth?invite=${inviteToken}`);
          return;
        }
        navigate(`/games/${data.gameId}`);
      } catch (error) {
        setMessage(error.message);
        setFailed(true);
      }
    }

    join();
  }, [inviteToken, navigate]);

  return (
    <div className="page">
      <div className="card stack">
        <p className={failed ? 'error' : undefined} role={failed ? 'alert' : undefined}>{message}</p>
        {failed && <Link className="button button-secondary" to="/dashboard">Back to dashboard</Link>}
      </div>
    </div>
  );
}
