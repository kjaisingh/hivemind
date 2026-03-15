import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';

export default function RoundResultsPage() {
  const { gameId, roundId } = useParams();
  const [round, setRound] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/api/games/${gameId}/rounds/${roundId}/results`)
      .then((data) => setRound(data.round))
      .catch((loadError) => setError(loadError.message));
  }, [gameId, roundId]);

  if (error) {
    return <div className="page"><p className="error">{error}</p></div>;
  }

  if (!round) {
    return <div className="page"><p>Loading results...</p></div>;
  }

  return (
    <div className="page stack-lg">
      <header className="row-between">
        <div>
          <h1>{round.gameName} — {round.name}</h1>
          <p>Your score: {round.ownScore.totalScore} points • Weekly rank: #{round.ownScore.rank}</p>
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
              </tr>
            </thead>
            <tbody>
              {round.leaderboard.map((row) => (
                <tr key={row.userId}>
                  <td>{row.rank}</td>
                  <td>{row.username}</td>
                  <td>{row.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        {round.questions.map((question) => (
          <article className="card stack" key={question.id}>
            <h3>{question.prompt}</h3>
            <p><strong>Your answer:</strong> <span className="highlight">{question.yourAnswer || 'No answer submitted'}</span></p>

            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={question.stats}>
                  <XAxis dataKey="displayAnswer" hide />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value, _name, payload) => [`${value} responses`, `${payload.payload.displayAnswer} (${payload.payload.percentage.toFixed(1)}%)`]} />
                  <Bar dataKey="count" fill="#3d7eff" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <ul className="stack">
              {question.stats.map((stat) => (
                <li className="list-item" key={stat.id}>
                  <span>{stat.displayAnswer}</span>
                  <span>{stat.count} ({stat.percentage.toFixed(1)}%)</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}
