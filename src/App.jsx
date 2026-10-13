import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import JoinPage from './pages/JoinPage';
import ProtectedRoute from './components/ProtectedRoute';
import ThemeToggle from './components/ThemeToggle';
import NotFoundPage from './pages/NotFoundPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
const RoundResultsPage = lazy(() => import('./pages/RoundResultsPage'));

export default function App() {
  return (
    <>
      <Suspense fallback={<main className="page" aria-busy="true"><p role="status">Loading Hivemind...</p></main>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/dashboard"
            element={(
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            )}
          />
          <Route path="/join/:inviteToken" element={<JoinPage />} />
          <Route
            path="/games/:gameId"
            element={(
              <ProtectedRoute>
                <GamePage />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/games/:gameId/rounds/:roundId/results"
            element={(
              <ProtectedRoute>
                <RoundResultsPage />
              </ProtectedRoute>
            )}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <ThemeToggle />
    </>
  );
}
