import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function JoinPage() {
  const { inviteToken } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('Joining game...');

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
      }
    }

    join();
  }, [inviteToken, navigate]);

  return (
    <div className="page">
      <div className="card"><p>{message}</p></div>
    </div>
  );
}
