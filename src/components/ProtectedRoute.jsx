import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth';

export default function ProtectedRoute({ children }) {
  const { user, loading, error, refresh } = useAuth();
  const location = useLocation();

  if (loading) {
    return <main className="page" aria-busy="true"><p role="status">Connecting to Hivemind...</p></main>;
  }

  if (error) {
    return <main className="page stack">
      <p className="error" role="alert">{error}</p>
      <button className="button" type="button" onClick={refresh}>Try again</button>
    </main>;
  }

  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  return children;
}
