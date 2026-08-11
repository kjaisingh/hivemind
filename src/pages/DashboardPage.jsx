import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { getUrgencyTier, formatTimeRemaining, urgencyPillClass } from '../lib/countdown';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [games, setGames] = useState([]);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [joinCode, setJoinCode] = useState('');
  const [creatingGame, setCreatingGame] = useState(false);
  const [joiningGame, setJoiningGame] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  async function loadDashboard() {
    const data = await api('/api/dashboard');
    setGames(data.games);
  }

  useEffect(() => {
    loadDashboard().catch((loadError) => setError(loadError.message));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const pendingAlerts = useMemo(() => games.filter((game) => game.hasPendingSubmission), [games]);
  const recentActivity = useMemo(
    () => games.flatMap((game) => game.recentClosedRounds.map((round) => ({ ...round, gameName: game.name, gameId: game.id }))).slice(0, 8),
    [games],
  );

  async function createGame(event) {
    event.preventDefault();
    setError('');
    setCreatingGame(true);

    try {
      const data = await api('/api/games', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      navigate(`/games/${data.game.id}`);
    } catch (createError) {
      setError(createError.message);
      setCreatingGame(false);
    }
  }

  async function joinGame(event) {
    event.preventDefault();
    setError('');
    setJoiningGame(true);

    try {
      const data = await api('/api/games/join', {
        method: 'POST',
        body: JSON.stringify({ code: joinCode }),
      });
      navigate(`/games/${data.gameId}`);
    } catch (joinError) {
      setError(joinError.message);
      setJoiningGame(false);
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setUser(null);
      navigate('/');
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  return (
    <div className="page stack-lg">
      <header className="row-between">
        <div>
          <h1>Welcome, {user?.username}</h1>
          <p>Your hive is buzzing across {games.length} game(s).</p>
        </div>
        <div className="row">
          <button className="button button-secondary" onClick={logout} type="button">Logout</button>
        </div>
      </header>

      <section className="grid-two">
        <div className="card">
          <h2>Create Game</h2>
          <form className="stack" onSubmit={createGame}>
            <input
              placeholder="Game name"
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <textarea
              placeholder="Game description"
              value={createForm.description}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
              required
            />
            <button className="button" type="submit" disabled={creatingGame}>
              {creatingGame ? 'Creating...' : 'Create Game'}
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Join Game</h2>
          <form className="stack" onSubmit={joinGame}>
            <input
              placeholder="Enter game code (ABC-123)"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              required
            />
            <button className="button" type="submit" disabled={joiningGame}>
              {joiningGame ? 'Joining...' : 'Join'}
            </button>
          </form>
          <p className="small">Tip: invite links also auto-join if you are already signed in.</p>
        </div>
      </section>

      <section className="card">
        <h2>Actionable Alerts</h2>
        {pendingAlerts.length === 0 ? <p>No unanswered active rounds right now.</p> : (
          <ul className="stack">
            {pendingAlerts.map((game) => (
              <li key={game.id} className="list-item">
                <span>{game.name}: {game.activeRound?.name}</span>
                <Link className="button button-secondary" to={`/games/${game.id}`}>Answer now</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Active Games</h2>
        {games.length === 0 ? <p>No games yet. Create one or join with a code.</p> : (
        <div className="stack">
          {games.map((game) => (
            <button key={game.id} type="button" className="game-card" onClick={() => navigate(`/games/${game.id}`)}>
              <div>
                <strong>{game.name}</strong>
                <p>{game.description}</p>
                <p className="small">Code: {game.code} • Role: {game.role}</p>
              </div>
              {game.hasPendingSubmission && (
                <span className={urgencyPillClass(game.activeRound ? getUrgencyTier(game.activeRound.expiresAt, now) : 'normal')}>
                  Needs your answers{game.activeRound ? ` · ${formatTimeRemaining(game.activeRound.expiresAt, now)}` : ''}
                </span>
              )}
            </button>
          ))}
        </div>
        )}
      </section>

      <section className="card">
        <h2>Recent Activity</h2>
        {recentActivity.length === 0 ? <p>No rounds have closed yet.</p> : (
          <ul className="stack">
            {recentActivity.map((item) => (
              <li key={item.id} className="list-item">
                <span>{item.gameName}: {item.name}</span>
                <Link className="button button-secondary" to={`/games/${item.gameId}/rounds/${item.id}/results`}>View results</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
