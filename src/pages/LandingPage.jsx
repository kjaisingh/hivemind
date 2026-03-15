import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="page landing">
      <header className="hero">
        <div className="badge">Hivemind</div>
        <h1>Guess what your people will guess.</h1>
        <p>
          Hivemind is a multiplayer game where the best answer is not the smartest one.
          It is the one your whole group independently types at 11:58 PM.
        </p>
        <div className="hero-actions">
          <Link className="button" to="/auth">Play now</Link>
          <Link className="button button-secondary" to="/dashboard">Dashboard</Link>
        </div>
      </header>

      <section className="info-card">
        <h2>How it works</h2>
        <ul>
          <li>Join a game with an invite link or short code.</li>
          <li>Answer open-ended questions in each round.</li>
          <li>Your score per question equals how many people gave your exact answer.</li>
          <li>Most in-sync brain wins. Psychic powers optional.</li>
        </ul>
      </section>
    </div>
  );
}
