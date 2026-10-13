export default function LeaderboardTab({ game, userId }) {
  return (
    <section className="card" role="tabpanel" id="panel-leaderboard" aria-labelledby="tab-leaderboard">
      <h2>Season Leaderboard</h2>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Season leaderboard for {game.name}</caption>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Points</th>
              <th>Medals</th>
            </tr>
          </thead>
          <tbody>
            {game.leaderboard.length === 0 ? (
              <tr>
                <td colSpan={4}>No scores yet.</td>
              </tr>
            ) : (
              game.leaderboard.map((row) => (
                <tr key={row.userId} className={row.userId === userId ? 'own-row' : undefined}>
                  <td>{row.rank}</td>
                  <td>{row.username}</td>
                  <td>{row.points}</td>
                  <td aria-label={`${row.medals} ${row.medals === 1 ? 'medal' : 'medals'}`}>
                    {row.medals > 0 ? (
                      <><span aria-hidden="true">🥇</span> × {row.medals}</>
                    ) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
