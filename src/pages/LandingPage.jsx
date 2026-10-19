import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <main className="page landing">
      <header className="hero hero-grid">
        <div className="hero-copy">
          <div className="badge">The social guessing game</div>
          <h1>How well do you know your group?</h1>
          <p>
            Answer independently, earn points when your answers match, and see how your group
            thinks over a season of play.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/auth">Create or join a game</Link>
            <Link className="button button-secondary" to="/dashboard">Open dashboard</Link>
          </div>
        </div>

        <div className="hero-preview" aria-label="Example round preview">
          <div className="preview-topline">
            <span>Example round</span>
            <span>8 min left</span>
          </div>
          <h2>What snack disappears first?</h2>
          <p className="preview-caption">Choose the answer you think most players will give.</p>
          <div className="preview-answer">Chips</div>
          <div className="preview-answer preview-answer-active">Pizza</div>
          <div className="preview-answer">Cookies</div>
          <p className="preview-footer">7 of 9 players have answered</p>
        </div>
      </header>

      <section className="feature-grid" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="feature-heading">Easy to start. Better with every round.</h2>
        <article className="info-card">
          <span className="feature-number">01</span>
          <h3>Gather your group</h3>
          <p>Create a game and share a code, invite link, or QR code. Everyone plays from their own device.</p>
        </article>
        <article className="info-card">
          <span className="feature-number">02</span>
          <h3>Answer each round</h3>
          <p>Play with free-text or multiple-choice questions. Revise your answer until the round closes.</p>
        </article>
        <article className="info-card">
          <span className="feature-number">03</span>
          <h3>See who thinks alike</h3>
          <p>Compare answers, follow the leaderboard, and look back on the results throughout the season.</p>
        </article>
      </section>
    </main>
  );
}
