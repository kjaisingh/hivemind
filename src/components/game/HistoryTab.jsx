import dayjs from 'dayjs';
import { Link } from 'react-router-dom';

export default function HistoryTab({ game, gameId }) {
  return (
    <section className="card stack" role="tabpanel" id="panel-history" aria-labelledby="tab-history">
      <h2>Past Rounds</h2>
      {game.pastRounds.length === 0 ? (
        <p>No closed rounds yet.</p>
      ) : (
        game.pastRounds.map((round) => (
          <div key={round.id} className="list-item">
            <span>
              {round.name} • closed {dayjs(round.expiresAt).format('MMM D, YYYY h:mm A')}
            </span>
            <Link className="button button-secondary" to={`/games/${gameId}/rounds/${round.id}/results`}>
              Open results
            </Link>
          </div>
        ))
      )}
    </section>
  );
}
