import dayjs from 'dayjs';
import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useRevalidation } from '../lib/useRevalidation';
import { useAuth } from '../context/auth';
import { GAME_TABS, GAME_TAB_LABELS, resolveGameTab } from '../lib/gameTabs';
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
    startsAt: dayjs().format('YYYY-MM-DDTHH:mm'),
    expiresAt: dayjs().add(1, 'day').format('YYYY-MM-DDTHH:mm'),
    questions: [{ prompt: '', type: 'TEXT', choices: ['', ''] }],
  };
}

function defaultEmailSettings() {
  return { autoRoundOpen: true, autoResultsLive: true, expiringHours: [] };
}

function defaultManualEmail() {
  return { subject: '', message: '' };
}

export default function GamePage() {
  const { gameId } = useParams();
  return <Game key={gameId} gameId={gameId} />;
}

function Game({ gameId }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [game, setGame] = useState(null);
  const [activeTab, setActiveTab] = useState('active');
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [roundForm, setRoundForm] = useState(defaultRoundForm);
  const [announcement, setAnnouncement] = useState('');
  const [draftToPublish, setDraftToPublish] = useState('');
  const [emailSettings, setEmailSettings] = useState(defaultEmailSettings);
  const [manualEmail, setManualEmail] = useState(defaultManualEmail);
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
  const [progress, setProgress] = useState(null);
  const [answersDirty, setAnswersDirty] = useState(false);

  const loadGameRequestRef = useRef(0);
  const copyTimerRef = useRef(null);
  const answersDirtyRef = useRef(false);
  const savedAnswersRef = useRef({});
  const emailSettingsDirtyRef = useRef(false);
  const loadedRoundIdRef = useRef(null);
  const handleRoundExpire = useCallback(() => setRoundExpired(true), []);

  const loadGame = useCallback(async ({ background = false } = {}) => {
    const requestId = ++loadGameRequestRef.current;
    try {
      const data = await api(`/api/games/${gameId}`);
      if (requestId !== loadGameRequestRef.current) return;

      if (!background) setError('');
      setRefreshError('');
      setGame(data.game);
      const incomingRoundId = data.game.activeRound?.id || null;
      savedAnswersRef.current = Object.fromEntries(
        (data.game.activeRound?.answers || []).map((item) => [item.questionId, item.rawAnswer]),
      );
      if (!answersDirtyRef.current || loadedRoundIdRef.current !== incomingRoundId) {
        setAnswers(savedAnswersRef.current);
        answersDirtyRef.current = false;
        setAnswersDirty(false);
      }
      loadedRoundIdRef.current = incomingRoundId;

      const draftRounds = data.game.draftRounds || [];
      setDraftToPublish((current) =>
        draftRounds.some((round) => round.id === current) ? current : (draftRounds[0]?.id || ''),
      );

      const incomingEmailSettings = data.game.emailSettings;
      if (!emailSettingsDirtyRef.current) setEmailSettings(incomingEmailSettings
        ? {
          autoRoundOpen: incomingEmailSettings.autoRoundOpen,
          autoResultsLive: incomingEmailSettings.autoResultsLive,
          expiringHours: (incomingEmailSettings.expiringHoursCsv || '')
            .split(',')
            .filter(Boolean)
            .map(Number),
        }
        : defaultEmailSettings());

      if (data.game.role === 'ADMIN') {
        const suggestionsData = await api(`/api/games/${gameId}/suggestions`);
        if (requestId !== loadGameRequestRef.current) return;
        setSuggestions(suggestionsData.suggestions || []);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      if (requestId !== loadGameRequestRef.current) return;
      if (background) setRefreshError('Could not refresh the game. Reconnecting automatically.');
      else setError(err.message || 'Failed to load game');
    }
  }, [gameId]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    void loadGame();
    return () => { loadGameRequestRef.current += 1; };
  }, [loadGame]);

  const refreshGame = useCallback(() => loadGame({ background: true }), [loadGame]);
  useRevalidation(refreshGame, !savingAnswers && !creatingRound && !publishing && !savingEmailSettings);

  useEffect(() => {
    setRoundExpired(false);
  }, [game?.activeRound?.id]);

  useEffect(() => {
    if (roundExpired) void loadGame();
  }, [loadGame, roundExpired]);

  useEffect(() => {
    if (!game?.inviteUrl) {
      setQrDataUrl(null);
      return;
    }
    let active = true;
    QRCode.toDataURL(game.inviteUrl, { margin: 1, width: 200 })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [game?.inviteUrl]);

  useEffect(() => {
    const roundId = game?.activeRound?.id;
    if (!roundId) {
      setProgress(null);
      return undefined;
    }
    let active = true;
    let inFlight = false;
    const loadProgress = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const data = await api(`/api/games/${gameId}/rounds/${roundId}/progress`);
        if (active) setProgress(data);
      } catch {
        if (active) setProgress(null);
      } finally {
        inFlight = false;
      }
    };
    void loadProgress();
    const timer = setInterval(loadProgress, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gameId, game?.activeRound?.id]);

  useEffect(() => {
    if (!answersDirty) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [answersDirty]);

  const visibleTabs = useMemo(
    () => GAME_TABS.filter((tab) => tab !== 'manage' || game?.role === 'ADMIN'),
    [game?.role],
  );

  useEffect(() => {
    if (!game) return;
    const requestedTab = resolveGameTab(searchParams.get('tab'), game.role === 'ADMIN');
    setActiveTab(requestedTab);
    if (searchParams.get('tab') !== requestedTab) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('tab', requestedTab);
      setSearchParams(nextParams, { replace: true });
    }
  }, [game, searchParams, setSearchParams]);

  function confirmDiscardAnswers() {
    if (!answersDirtyRef.current) return true;
    if (!window.confirm('Discard your unsaved answers?')) return false;
    setAnswers(savedAnswersRef.current);
    answersDirtyRef.current = false;
    setAnswersDirty(false);
    return true;
  }

  function selectTab(tab) {
    if (tab === activeTab) return true;
    if (!confirmDiscardAnswers()) return false;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams);
    setActiveTab(tab);
    return true;
  }

  function handlePageLink(event) {
    if (!confirmDiscardAnswers()) event.preventDefault();
  }

  function resetRoundForm() {
    setEditingRoundId(null);
    setRoundForm(defaultRoundForm());
  }

  function updateAnswers(updater) {
    setAnswers(updater);
    answersDirtyRef.current = true;
    setAnswersDirty(true);
    setStatus('');
  }

  function handleTabKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = visibleTabs.indexOf(activeTab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? visibleTabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
    const nextTab = visibleTabs[nextIndex];
    if (selectTab(nextTab)) {
      event.currentTarget.parentElement.querySelector(`#tab-${nextTab}`)?.focus();
    }
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
    loadGameRequestRef.current += 1;
    setError('');
    setSavingAnswers(true);
    try {
      const payload = Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }));
      await api(`/api/games/${gameId}/active-round/save`, { method: 'POST', body: JSON.stringify({ answers: payload }) });
      savedAnswersRef.current = { ...answers };
      setStatus('Answers saved.');
      answersDirtyRef.current = false;
      setAnswersDirty(false);
    } catch (err) {
      setError(err.message || 'Failed to save answers');
    } finally {
      loadGameRequestRef.current += 1;
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

    if (!dayjs(roundForm.expiresAt).isAfter(dayjs(roundForm.startsAt))) {
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
    if (questions.some((question) => {
      if (question.type !== 'MULTIPLE_CHOICE') return false;
      const normalized = question.choices.map((choice) => choice.toLocaleLowerCase());
      return new Set(normalized).size !== normalized.length;
    })) {
      setError('Multiple choice options must be unique.');
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
      setStatus('Round published.');
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
      emailSettingsDirtyRef.current = false;
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
    setStatus('');
    setSendingEmail(true);
    try {
      const result = await api(`/api/games/${gameId}/email/manual`, { method: 'POST', body: JSON.stringify(manualEmail) });
      if (result.skippedCount > 0) {
        setError(`Email delivery is not configured. ${result.skippedCount} email${result.skippedCount === 1 ? '' : 's'} skipped.`);
      } else if (result.failedCount > 0) {
        setError(`Sent ${result.sentCount} of ${result.totalCount} emails. ${result.failedCount} failed.`);
      } else {
        setStatus(`Sent ${result.sentCount} email${result.sentCount === 1 ? '' : 's'}.`);
        setManualEmail(defaultManualEmail());
      }
    } catch (err) {
      setError(err.message || 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  }

  async function sendReminder() {
    setError('');
    setStatus('');
    setRemindingPlayers(true);
    try {
      const roundId = game.activeRound.id;
      const { remindedCount, pendingCount } = await api(`/api/games/${gameId}/rounds/${roundId}/remind`, { method: 'POST' });
      if (pendingCount === 0) {
        setStatus('Everyone has already submitted. No reminders needed.');
      } else if (remindedCount === pendingCount) {
        setStatus(`Reminded ${remindedCount} player(s) with unanswered questions.`);
      } else if (remindedCount === 0) {
        setError(`${pendingCount} player(s) are pending, but no reminder emails were sent. Check email configuration.`);
      } else {
        setError(`Reminded ${remindedCount} of ${pendingCount} pending player(s).`);
      }
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
      const data = await api(`/api/games/${gameId}/suggestions`, { method: 'POST', body: JSON.stringify({ prompt: suggestionPrompt }) });
      setStatus('Suggestion submitted. Thanks!');
      setSuggestionPrompt('');
      if (game.role === 'ADMIN') {
        setSuggestions((current) => [{ ...data.suggestion, submittedBy: user }, ...current]);
      }
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
    emailSettingsDirtyRef.current = true;
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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  function updateEmailSettings(updater) {
    emailSettingsDirtyRef.current = true;
    setEmailSettings(updater);
  }

  if (error && !game) {
    return (
      <main className="page narrow stack">
        <p className="error" role="alert">{error}</p>
        <div className="row gap-sm">
          <button className="button" type="button" onClick={loadGame}>Try again</button>
          <Link className="button button-secondary" to="/dashboard">Back to dashboard</Link>
        </div>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="page" aria-busy="true">
        <p role="status">Loading game...</p>
      </main>
    );
  }

  return (
    <main className="page stack-lg">
      <div className="row-between">
        <div>
          <h1>{game.name}</h1>
          <p>{game.description}</p>
          <span className="badge">Code: {game.code}</span>
        </div>
        <Link className="button button-secondary" to="/dashboard" onClick={handlePageLink}>
          Back
        </Link>
      </div>

      {refreshError && <p className="warning" role="status">{refreshError}</p>}
      <nav className="tab-row" role="tablist" aria-label="Game sections">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            id={`tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={`tab ${activeTab === tab ? 'tab-active' : ''}`}
            onClick={() => selectTab(tab)}
            onKeyDown={handleTabKeyDown}
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
          setAnswers={updateAnswers}
          answersDirty={answersDirty}
          progress={progress}
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
          emailConfigured={game.emailConfigured}
          emailSettings={emailSettings}
          setEmailSettings={updateEmailSettings}
          onToggleHour={toggleHour}
          savingEmailSettings={savingEmailSettings}
          onSaveEmailSettings={saveEmailSettings}
          manualEmail={manualEmail}
          setManualEmail={setManualEmail}
          sendingEmail={sendingEmail}
          onSendManualEmail={sendManualEmail}
        />
      )}

      {status && <p className="success" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
