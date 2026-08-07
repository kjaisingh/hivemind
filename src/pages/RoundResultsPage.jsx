import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

function normalizeAnswer(answer) {
  return answer
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function RoundResultsPage() {
  const { gameId, roundId } = useParams();
  const { user } = useAuth();
  const [round, setRound] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/api/games/${gameId}/rounds/${roundId}/results`)
      .then((data) => setRound(data.round))
      .catch((loadError) => setError(loadError.message));
  }, [gameId, roundId]);

  if (error) {
    return <div className="page"><p className="error" role="alert">{error}</p></div>;
  }

  if (!round) {
    return <div className="page"><p>Loading results...</p></div>;
  }

  return (
    <div className="page stack-lg">
      <header className="row-between">
        <div>
          <h1>{round.gameName} — {round.name}</h1>
          <p className="score-headline">
            Your score: {round.ownScore.totalScore} points{round.ownScore.medalAwarded ? ' 🥇' : ''}
          </p>
          <p className="small">Weekly rank: #{round.ownScore.rank}</p>
        </div>
        <Link className="button button-secondary" to={`/games/${gameId}`}>Back to game</Link>
      </header>

      <section className="card">
        <h2>Round Leaderboard</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Points</th>
                <th>Medal</th>
              </tr>
            </thead>
            <tbody>
              {round.leaderboard.length === 0 ? (
                <tr><td colSpan={4}>No scores yet.</td></tr>
              ) : (
                round.leaderboard.map((row) => (
                  <tr key={row.userId} className={row.userId === user?.id ? 'own-row' : undefined}>
                    <td>{row.rank}</td>
                    <td>{row.username}</td>
                    <td>{row.totalScore}</td>
                    <td>{row.medalAwarded ? '🥇' : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        {round.questions.length === 0 ? (
          <p>No questions in this round.</p>
        ) : round.questions.map((question) => {
          const ownAnswer = normalizeAnswer(question.yourAnswer || '');

          return (
            <article className="card stack" key={question.id}>
              <h3>{question.prompt}</h3>
              <p><strong>Your answer:</strong> <span className="highlight">{question.yourAnswer || 'No answer submitted'}</span></p>

              {question.stats.length === 0 ? <p>No answers submitted for this question.</p> : (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={question.stats}>
                      <XAxis dataKey="displayAnswer" interval={0} tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip formatter={(value, _name, payload) => [`${value} responses`, `${payload.payload.displayAnswer} (${payload.payload.percentage.toFixed(1)}%)`]} />
                      <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                        {question.stats.map((stat) => (
                          <Cell
                            key={stat.id}
                            fill={ownAnswer && normalizeAnswer(stat.displayAnswer) === ownAnswer ? '#2563eb' : '#cbd5e1'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="card row-between">
        <div>
          <h2>What&apos;s next?</h2>
          <p className="small">See where you stand across the season, or head back to the game.</p>
        </div>
        <Link className="button" to={`/games/${gameId}`}>Season leaderboard</Link>
      </section>
    </div>
  );
}
