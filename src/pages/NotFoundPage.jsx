import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="page auth-page">
      <div className="card stack">
        <span className="badge">404</span>
        <h1>Page not found</h1>
        <p>This link may be outdated, or the page may have moved.</p>
        <Link className="button" to="/dashboard">Go to dashboard</Link>
      </div>
    </main>
  );
}
