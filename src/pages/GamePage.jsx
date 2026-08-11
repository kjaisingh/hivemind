import dayjs from 'dayjs';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { GAME_TABS, GAME_TAB_LABELS } from '../lib/gameTabs';
import ActiveRoundTab from '../components/game/ActiveRoundTab';
import LeaderboardTab from '../components/game/LeaderboardTab';
import HistoryTab from '../components/game/HistoryTab';
import ShareTab from '../components/game/ShareTab';
import SuggestTab from '../components/game/SuggestTab';
import ManageTab from '../components/game/ManageTab';

function defaultRoundForm() {
  return {
    name: '',
    description: '',
    startsAt: '',
    expiresAt: '',
    questions: [{ prompt: '', type: 'TEXT', choices: ['', ''] }],
  };
}

export default function GamePage() {
  const { gameId } = useParams();
  const { user } = useAuth();

  const [game, setGame] = useState(null);
  const [activeTab, setActiveTab] = useState('active');
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [roundForm, setRoundForm] = useState(defaultRoundForm());
  const [announcement, setAnnouncement] = useState('');
  const [draftToPublish, setDraftToPublish] = useState('');
  const [emailSettings, setEmailSettings] = useState({ autoRoundOpen: true, autoResultsLive: true, expiringHours: [] });
  const [manualEmail, setManualEmail] = useState({ subject: '', message: '' });
  const [roundExpired, setRoundExpired] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [creatingRound, setCreatingRound] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savingEmailSettings, setSavingEmailSettings] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [remindingPlayers, setRemindingPlayers] = useState(false);
  const [editingRoundId, setEditingRoundId] = useState(null);
  const [deletingRoundId, setDeletingRoundId] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionPrompt, setSuggestionPrompt] = useState('');
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);
  const [promoteTargets, setPromoteTargets] = useState({});
  const [copiedField, setCopiedField] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [dismissingSuggestionId, setDismissingSuggestionId] = useState(null);
  const [promotingSuggestionId, setPromotingSuggestionId] = useState(null);

  const loadGameRequestRef = useRef(0);
  const handleRoundExpire = useCallback(() => setRoundExpired(true), []);

  const loadGame = useCallback(async () => {
    const requestId = ++loadGameRequestRef.current;
    try {
      const data = await api(`/api/games/${gameId}`);
      if (requestId !== loadGameRequestRef.current) return;

      setGame(data.game);
      setAnswers(
        data.game.activeRound
          ? Object.fromEntries(data.game.activeRound.answers.map((item) => [item.questionId, item.rawAnswer]))
          : {},
      );

      const draftRounds = data.game.draftRounds || [];
      if (draftRounds.length > 0 && !draftToPublish) {
        setDraftToPublish(draftRounds[0].id);
      }

      if (data.game.emailSettings) {
        setEmailSettings({
          autoRoundOpen: data.game.emailSettings.autoRoundOpen,
          autoResultsLive: data.game.emailSettings.autoResultsLive,
          expiringHours: (data.game.emailSettings.expiringHoursCsv || '')
            .split(',')
            .filter(Boolean)
            .map(Number),
        });
      }

      if (data.game.role === 'ADMIN') {
        const suggestionsData = await api(`/api/games/${gameId}/suggestions`);
        setSuggestions(suggestionsData.suggestions || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load game');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    loadGame();
  }, [loadGame]);

  useEffect(() => {
    setRoundExpired(false);
  }, [game?.activeRound?.id]);

  useEffect(() => {
    if (!game?.inviteUrl) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(game.inviteUrl, { margin: 1, width: 200 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [game?.inviteUrl]);

  const visibleTabs = useMemo(
    () => GAME_TABS.filter((tab) => tab !== 'manage' || game?.role === 'ADMIN'),
    [game?.role],
  );

  function resetRoundForm() {
    setEditingRoundId(null);
    setRoundForm(defaultRoundForm());
  }

  function startEditRound(round) {
    setEditingRoundId(round.id);
    setRoundForm({
      name: round.name,
      description: round.description || '',
      startsAt: dayjs(round.startsAt).format('YYYY-MM-DDTHH:mm'),
      expiresAt: dayjs(round.expiresAt).format('YYYY-MM-DDTHH:mm'),
      questions: round.questions.map((question) => ({
        prompt: question.prompt,
        type: question.type,
        choices: question.choices && question.choices.length > 0 ? question.choices : ['', ''],
      })),
    });
  }

  async function saveAnswers() {
    setError('');
    setSavingAnswers(true);
    try {
      const payload = Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }));
      await api(`/api/games/${gameId}/active-round/save`, { method: 'POST', body: JSON.stringify({ answers: payload }) });
      setStatus('Answers saved.');
    } catch (err) {
      setError(err.message || 'Failed to save answers');
    } finally {
      setSavingAnswers(false);
    }
  }

  async function deleteRound(round) {
    if (!window.confirm(`Delete draft round "${round.name}"?`)) return;
    setError('');
    setDeletingRoundId(round.id);
    try {
      await api(`/api/games/${gameId}/rounds/${round.id}`, { method: 'DELETE' });
      if (editingRoundId === round.id) resetRoundForm();
      await loadGame();
    } catch (err) {
      setError(err.message || 'Failed to delete round');
    } finally {
      setDeletingRoundId(null);
    }
  }

  async function submitRoundForm(event) {
    event.preventDefault();
    setError('');

    if (dayjs(roundForm.expiresAt).isBefore(dayjs(roundForm.startsAt))) {
      setError('Expiry must be after the start time.');
      return;
    }

    const questions = roundForm.questions.map((question) =>
      question.type === 'MULTIPLE_CHOICE'
        ? { prompt: question.prompt.trim(), type: question.type, choices: question.choices.map((choice) => choice.trim()).filter(Boolean) }
        : { prompt: question.prompt.trim(), type: question.type },
    );

    if (questions.some((question) => question.type === 'MULTIPLE_CHOICE' && question.choices.length < 2)) {
      setError('Multiple choice questions need at least two choices.');
      return;
    }

    const payload = {
      name: roundForm.name,
      description: roundForm.description,
      startsAt: dayjs(roundForm.startsAt).toISOString(),
      expiresAt: dayjs(roundForm.expiresAt).toISOString(),
      questions,
    };

    setCreatingRound(true);
    try {
      if (editingRoundId) {
        await api(`/api/games/${gameId}/rounds/${editingRoundId}`, { method: 'PUT', body: JSON.stringify(payload) });
        setStatus('Round draft updated.');
      } else {
        await api(`/api/games/${gameId}/rounds`, { method: 'POST', body: JSON.stringify(payload) });
        setStatus('Round draft created.');
      }
      resetRoundForm();
      await loadGame();
    } catch (err) {
      setError(err.message || 'Failed to save round');
    } finally {
      setCreatingRound(false);
    }
  }

  async function publishRound(event) {
    event.preventDefault();
    if (!draftToPublish) return;
    setError('');
    setPublishing(true);
    try {
      await api(`/api/games/${gameId}/rounds/${draftToPublish}/publish`, {
        method: 'POST',
        body: JSON.stringify({ announcement }),
      });
      setStatus('Round published. Emails are on the way.');
      setAnnouncement('');
      await loadGame();
    } catch (err) {
      setError(err.message || 'Failed to publish round');
    } finally {
      setPublishing(false);
    }
  }

  async function saveEmailSettings(event) {
    event.preventDefault();
    setError('');
    setSavingEmailSettings(true);
    try {
      await api(`/api/games/${gameId}/email-settings`, { method: 'PUT', body: JSON.stringify(emailSettings) });
      setStatus('Email settings saved.');
    } catch (err) {
      setError(err.message || 'Failed to save email settings');
    } finally {
      setSavingEmailSettings(false);
    }
  }

  async function sendManualEmail(event) {
    event.preventDefault();
    setError('');
    setSendingEmail(true);
    try {
      await api(`/api/games/${gameId}/email`, { method: 'POST', body: JSON.stringify(manualEmail) });
      setStatus('Email sent.');
      setManualEmail({ subject: '', message: '' });
    } catch (err) {
      setError(err.message || 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  }

  async function sendReminder() {
    setError('');
    setRemindingPlayers(true);
    try {
      const roundId = game.activeRound.id;
      const { remindedCount } = await api(`/api/games/${gameId}/rounds/${roundId}/remind`, { method: 'POST' });
      setStatus(
        remindedCount > 0
          ? `Reminded ${remindedCount} player(s) with unanswered questions.`
          : 'Everyone has already submitted — no reminders needed.',
      );
    } catch (err) {
      setError(err.message || 'Failed to send reminder');
    } finally {
      setRemindingPlayers(false);
    }
  }

  async function submitSuggestion(event) {
    event.preventDefault();
    setError('');
    setSubmittingSuggestion(true);
    try {
      await api(`/api/games/${gameId}/suggestions`, { method: 'POST', body: JSON.stringify({ prompt: suggestionPrompt }) });
      setStatus('Suggestion submitted. Thanks!');
      setSuggestionPrompt('');
      await loadGame();
    } catch (err) {
      setError(err.message || 'Failed to submit suggestion');
    } finally {
      setSubmittingSuggestion(false);
    }
  }

  async function dismissSuggestion(suggestion) {
    setError('');
    setDismissingSuggestionId(suggestion.id);
    try {
      await api(`/api/games/${gameId}/suggestions/${suggestion.id}/dismiss`, { method: 'POST' });
      setStatus('Suggestion dismissed.');
      await loadGame();
    } catch (err) {
      setError(err.message || 'Failed to dismiss suggestion');
    } finally {
      setDismissingSuggestionId(null);
    }
  }

  async function promoteSuggestion(suggestion) {
    const options = game.draftRounds || [];
    const roundId = promoteTargets[suggestion.id] || options[0]?.id;
    if (!roundId) {
      setError('Create a draft round first.');
      return;
    }
    setError('');
    setPromotingSuggestionId(suggestion.id);
    try {
      await api(`/api/games/${gameId}/suggestions/${suggestion.id}/promote`, { method: 'POST', body: JSON.stringify({ roundId }) });
      setStatus('Suggestion promoted into a draft round.');
      await loadGame();
    } catch (err) {
      setError(err.message || 'Failed to promote suggestion');
    } finally {
      setPromotingSuggestionId(null);
    }
  }

  function toggleHour(hour) {
    setEmailSettings((prev) => ({
      ...prev,
      expiringHours: prev.expiringHours.includes(hour)
        ? prev.expiringHours.filter((item) => item !== hour)
        : [...prev.expiringHours, hour].sort((a, b) => b - a),
    }));
  }

  async function copyToClipboard(value, field) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  if (error && !game) {
    return (
      <div className="page stack">
        <p className="error">{error}</p>
        <Link className="button" to="/dashboard">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="page">
        <p>Loading game...</p>
      </div>
    );
  }

  return (
    <div className="page stack-lg">
      <div className="row-between">
        <div>
          <h1>{game.name}</h1>
          <p>{game.description}</p>
          <span className="badge">Code: {game.code}</span>
        </div>
        <Link className="button button-secondary" to="/dashboard">
          Back
        </Link>
      </div>

      <nav className="tab-row" role="tablist">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            id={`tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`panel-${tab}`}
            className={`tab ${activeTab === tab ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {GAME_TAB_LABELS[tab]}
          </button>
        ))}
      </nav>

      {activeTab === 'active' && (
        <ActiveRoundTab
          game={game}
          answers={answers}
          setAnswers={setAnswers}
          roundExpired={roundExpired}
          onExpire={handleRoundExpire}
          savingAnswers={savingAnswers}
          onSave={saveAnswers}
          remindingPlayers={remindingPlayers}
          onRemind={sendReminder}
        />
      )}

      {activeTab === 'leaderboard' && <LeaderboardTab game={game} userId={user?.id} />}

      {activeTab === 'history' && <HistoryTab game={game} gameId={gameId} />}

      {activeTab === 'share' && (
        <ShareTab game={game} qrDataUrl={qrDataUrl} copiedField={copiedField} onCopy={copyToClipboard} />
      )}

      {activeTab === 'suggest' && (
        <SuggestTab
          game={game}
          suggestions={suggestions}
          suggestionPrompt={suggestionPrompt}
          setSuggestionPrompt={setSuggestionPrompt}
          onSubmitSuggestion={submitSuggestion}
          submittingSuggestion={submittingSuggestion}
          draftRounds={game.draftRounds || []}
          promoteTargets={promoteTargets}
          setPromoteTargets={setPromoteTargets}
          onPromote={promoteSuggestion}
          onDismiss={dismissSuggestion}
          promotingSuggestionId={promotingSuggestionId}
          dismissingSuggestionId={dismissingSuggestionId}
        />
      )}

      {activeTab === 'manage' && game.role === 'ADMIN' && (
        <ManageTab
          roundForm={roundForm}
          setRoundForm={setRoundForm}
          editingRoundId={editingRoundId}
          creatingRound={creatingRound}
          onSubmitRoundForm={submitRoundForm}
          onCancelEdit={resetRoundForm}
          draftRounds={game.draftRounds || []}
          draftToPublish={draftToPublish}
          setDraftToPublish={setDraftToPublish}
          announcement={announcement}
          setAnnouncement={setAnnouncement}
          publishing={publishing}
          onPublish={publishRound}
          onEditRound={startEditRound}
          onDeleteRound={deleteRound}
          deletingRoundId={deletingRoundId}
          emailSettings={emailSettings}
          setEmailSettings={setEmailSettings}
          onToggleHour={toggleHour}
          savingEmailSettings={savingEmailSettings}
          onSaveEmailSettings={saveEmailSettings}
          manualEmail={manualEmail}
          setManualEmail={setManualEmail}
          sendingEmail={sendingEmail}
          onSendManualEmail={sendManualEmail}
        />
      )}

      {status && <p className="success">{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
