import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <main className="page landing">
      <header className="hero hero-grid">
        <div className="stack-lg">
          <div className="badge">The social guessing game</div>
          <h1>Don&apos;t find the right answer. Find the group&apos;s answer.</h1>
          <p>
            Ask anything, answer independently, then score points when your instincts match the hive.
            Built for friends, teams, and recurring game nights.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/auth">Start a game</Link>
            <Link className="button button-secondary" to="/dashboard">Open dashboard</Link>
          </div>
        </div>
        <div className="hero-preview" aria-label="Example round preview">
          <span className="pill pill-accent">Round 4 · 8m left</span>
          <h2>What snack disappears first?</h2>
          <div className="preview-answer">Chips</div>
          <div className="preview-answer preview-answer-active">Pizza</div>
          <div className="preview-answer">Cookies</div>
          <p className="small">7 of 9 players submitted</p>
        </div>
      </header>

      <section className="feature-grid" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="feature-heading">One minute to learn. Endless group lore.</h2>
        <article className="info-card">
          <span className="feature-number">01</span>
          <h3>Gather your hive</h3>
          <p>Share a short code, invite link, or QR code. Private games keep each group separate.</p>
        </article>
        <article className="info-card">
          <span className="feature-number">02</span>
          <h3>Answer the round</h3>
          <p>Mix free-text and multiple-choice questions. Save and revise answers until time runs out.</p>
        </article>
        <article className="info-card">
          <span className="feature-number">03</span>
          <h3>Match minds</h3>
          <p>Every matching answer adds points. Results, breakdowns, medals, and season rankings update automatically.</p>
        </article>
      </section>
    </main>
  );
}
