import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../context/auth';
import { buildAnswerSummaryCsv } from '../lib/resultsCsv';

export default function RoundResultsPage() {
  const { gameId, roundId } = useParams();
  const { user } = useAuth();
  const routeKey = `${gameId}/${roundId}`;
  const [result, setResult] = useState({ routeKey: '', round: null, error: '' });
  const [retry, setRetry] = useState(0);
  const round = result.routeKey === routeKey ? result.round : null;
  const error = result.routeKey === routeKey ? result.error : '';
  const [isDark, setIsDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');

  useEffect(() => {
    let active = true;
    setResult({ routeKey, round: null, error: '' });
    api(`/api/games/${gameId}/rounds/${roundId}/results`)
      .then((data) => {
        if (active) setResult({ routeKey, round: data.round, error: '' });
      })
      .catch((loadError) => {
        if (active) setResult({ routeKey, round: null, error: loadError.message });
      });
    return () => { active = false; };
  }, [gameId, roundId, routeKey, retry]);

  useEffect(() => {
    const handleThemeChange = (event) => setIsDark(event.detail === 'dark');
    window.addEventListener('hivemind-theme-change', handleThemeChange);
    return () => window.removeEventListener('hivemind-theme-change', handleThemeChange);
  }, []);

  function downloadAnswers() {
    const csv = buildAnswerSummaryCsv(round.questions);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `hivemind-${round.id}-answers.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (error) {
    return (
      <main className="page stack">
        <p className="error" role="alert">{error}</p>
        <button className="button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
        <Link className="button button-secondary" to={`/games/${gameId}`}>Back to game</Link>
      </main>
    );
  }

  if (!round) {
    return <main className="page" aria-busy="true"><p role="status">Loading results...</p></main>;
  }

  return (
    <main className="page stack-lg">
      <header className="row-between">
        <div>
          <h1>{round.gameName}: {round.name}</h1>
          <p className="score-headline">
            Your score: {round.ownScore.totalScore} {round.ownScore.totalScore === 1 ? 'point' : 'points'}
            {round.ownScore.medalAwarded ? (
              <span aria-label="Medal awarded"> <span aria-hidden="true">🥇</span></span>
            ) : ''}
          </p>
          <p className="small">Round rank: #{round.ownScore.rank}</p>
        </div>
        <div className="row">
          <button className="button button-secondary" type="button" onClick={downloadAnswers}>Download answer summary</button>
          <Link className="button button-secondary" to={`/games/${gameId}`}>Back to game</Link>
        </div>
      </header>

      <section className="card">
        <h2>Round Leaderboard</h2>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Round leaderboard for {round.name}</caption>
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
                    <td>{row.medalAwarded ? <span aria-label="Medal awarded" role="img">🥇</span> : '—'}</td>
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
          const ownAnswer = question.yourNormalizedAnswer || '';
          const otherFill = isDark ? '#475569' : '#cbd5e1';
          const tickFill = isDark ? '#cbd5e1' : '#666';

          return (
            <article className="card stack" key={question.id}>
              <h3>{question.prompt}</h3>
              <p><strong>Your answer:</strong> <span className="highlight">{question.yourAnswer || 'No answer submitted'}</span></p>

              {question.stats.length === 0 ? <p>No answers submitted for this question.</p> : (
                <div className="chart-wrap" aria-hidden="true">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={question.stats}>
                      <XAxis dataKey="displayAnswer" interval={0} tick={{ fontSize: 12, fill: tickFill }} />
                      <YAxis allowDecimals={false} tick={{ fill: tickFill }} />
                      <Tooltip formatter={(value, _name, payload) => [`${value} responses`, `${payload.payload.displayAnswer} (${payload.payload.percentage.toFixed(1)}%)`]} />
                      <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                        {question.stats.map((stat) => (
                          <Cell
                            key={stat.id}
                            fill={ownAnswer && stat.normalizedAnswer === ownAnswer ? '#2563eb' : otherFill}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {question.stats.length > 0 && (
                <ul className="result-data" aria-label={`Response totals for ${question.prompt}`}>
                  {question.stats.map((stat) => (
                    <li key={stat.id || stat.normalizedAnswer}>
                      <span>{stat.displayAnswer}</span>
                      <strong>{stat.count} ({stat.percentage.toFixed(1)}%)</strong>
                    </li>
                  ))}
                </ul>
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
        <Link className="button" to={`/games/${gameId}?tab=leaderboard`}>Season leaderboard</Link>
      </section>
    </main>
  );
}
