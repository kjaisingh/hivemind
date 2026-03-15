import { Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import GamePage from './pages/GamePage';
import RoundResultsPage from './pages/RoundResultsPage';
import JoinPage from './pages/JoinPage';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
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
      <Route
        path="/join/:inviteToken"
        element={(
          <ProtectedRoute>
            <JoinPage />
          </ProtectedRoute>
        )}
      />
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
    </Routes>
  );
}
