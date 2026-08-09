import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getUrgencyTier, urgencyPillClass } from '../lib/countdown';

const tabs = ['active', 'leaderboard', 'history', 'share', 'suggest', 'manage'];

function Countdown({ expiresAt, onExpire }) {
  const [label, setLabel] = useState(null);
  const [tier, setTier] = useState('normal');

  useEffect(() => {
    function tick() {
      const diff = dayjs(expiresAt).diff(dayjs(), 'second');
      setTier(getUrgencyTier(expiresAt));
      if (diff <= 0) {
        setLabel('Round closed');
        onExpire?.();
        return;
      }
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);
      setLabel(`${parts.join(' ')} left`);
    }

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  return <p className={urgencyPillClass(tier)} aria-live="polite">{label ?? 'Loading time remaining...'}</p>;
}

export default function GamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [activeTab, setActiveTab] = useState('active');
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const [roundForm, setRoundForm] = useState({
    name: '',
    description: '',
    startsAt: '',
    expiresAt: '',
    questions: ['', ''],
  });
  const [announcement, setAnnouncement] = useState('New round is up. Bring your crowd-reading superpowers.');
  const [draftToPublish, setDraftToPublish] = useState('');
  const [emailSettings, setEmailSettings] = useState({
    autoRoundOpen: true,
    autoResultsLive: true,
    expiringHours: [24, 1],
  });
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
  const [dismissingSuggestionId, setDismissingSuggestionId] = useState(null);
  const [promotingSuggestionId, setPromotingSuggestionId] = useState(null);

  const handleRoundExpire = useCallback(() => setRoundExpired(true), []);
  const loadGameRequestRef = useRef(0);

  async function loadGame() {
    const requestId = ++loadGameRequestRef.current;
    const data = await api(`/api/games/${gameId}`);
    if (requestId !== loadGameRequestRef.current) return;
    setGame(data.game);

    if (data.game.activeRound) {
      const saved = Object.fromEntries(data.game.activeRound.answers.map((item) => [item.questionId, item.rawAnswer]));
      setAnswers(saved);
    }

    const draftRounds = data.game.draftRounds || [];
    if (draftRounds.length > 0 && !draftToPublish) {
      setDraftToPublish(draftRounds[0].id);
    }

    if (data.game.emailSettings) {
      setEmailSettings({
        autoRoundOpen: data.game.emailSettings.autoRoundOpen,
        autoResultsLive: data.game.emailSettings.autoResultsLive,
        expiringHours: data.game.emailSettings.expiringHoursCsv
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isFinite(value) && value > 0),
      });
    }

    if (data.game.role === 'ADMIN') {
      try {
        const suggestionData = await api(`/api/games/${gameId}/suggestions`);
        if (requestId !== loadGameRequestRef.current) return;
        setSuggestions(suggestionData.suggestions);
      } catch {
        if (requestId === loadGameRequestRef.current) setSuggestions([]);
      }
    } else {
      setSuggestions([]);
    }
  }

  useEffect(() => {
    loadGame().catch((loadError) => setError(loadError.message));
  }, [gameId]);

  useEffect(() => {
    setRoundExpired(false);
  }, [game?.activeRound?.id]);

  const visibleTabs = useMemo(
    () => tabs.filter((tab) => tab !== 'manage' || game?.role === 'ADMIN'),
    [game?.role],
  );

  async function saveAnswers() {
    setStatus('Saving answers...');
    setError('');
    setSavingAnswers(true);
    try {
      await api(`/api/games/${gameId}/active-round/save`, {
        method: 'POST',
        body: JSON.stringify({
          answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })),
        }),
      });
      setStatus('Answers saved. You can edit until the round expires.');
      await loadGame();
    } catch (saveError) {
      setStatus('');
      setError(saveError.message);
    } finally {
      setSavingAnswers(false);
    }
  }

  function resetRoundForm() {
    setEditingRoundId(null);
    setRoundForm({
      name: '',
      description: '',
      startsAt: '',
      expiresAt: '',
      questions: ['', ''],
    });
  }

  function startEditRound(round) {
    setEditingRoundId(round.id);
    setRoundForm({
      name: round.name,
      description: round.description || '',
      startsAt: dayjs(round.startsAt).format('YYYY-MM-DDTHH:mm'),
      expiresAt: dayjs(round.expiresAt).format('YYYY-MM-DDTHH:mm'),
      questions: round.questions.length > 0 ? round.questions : ['', ''],
    });
    setError('');
    setStatus('');
  }

  async function deleteRound(round) {
    if (!window.confirm(`Delete draft round "${round.name}"? This cannot be undone.`)) {
      return;
    }

    setError('');
    setDeletingRoundId(round.id);
    try {
      await api(`/api/games/${gameId}/rounds/${round.id}`, { method: 'DELETE' });

      if (editingRoundId === round.id) {
        resetRoundForm();
      }
      if (draftToPublish === round.id) {
        setDraftToPublish('');
      }

      setStatus('Draft round deleted.');
      await loadGame();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeletingRoundId(null);
    }
  }

  async function submitRoundForm(event) {
    event.preventDefault();
    setError('');

    const startsAtDate = new Date(roundForm.startsAt);
    const expiresAtDate = new Date(roundForm.expiresAt);
    if (Number.isNaN(startsAtDate.getTime()) || Number.isNaN(expiresAtDate.getTime())) {
      setError('Enter valid start and expiry times.');
      return;
    }

    const payload = {
      ...roundForm,
      startsAt: startsAtDate.toISOString(),
      expiresAt: expiresAtDate.toISOString(),
      questions: roundForm.questions.map((question) => question.trim()).filter(Boolean),
    };

    setCreatingRound(true);
    try {
      if (editingRoundId) {
        await api(`/api/games/${gameId}/rounds/${editingRoundId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStatus('Round draft updated.');
      } else {
        await api(`/api/games/${gameId}/rounds`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStatus('Round draft created. Publish it from the section below.');
      }

      resetRoundForm();
      await loadGame();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setCreatingRound(false);
    }
  }

  async function publishRound(event) {
    event.preventDefault();
    if (!draftToPublish) {
      return;
    }

    setError('');
    setPublishing(true);
    try {
      await api(`/api/games/${gameId}/rounds/${draftToPublish}/publish`, {
        method: 'POST',
        body: JSON.stringify({ announcement }),
      });

      setStatus('Round published. Emails were sent based on your settings.');
      await loadGame();
    } catch (publishError) {
      setError(publishError.message);
    } finally {
      setPublishing(false);
    }
  }

  async function saveEmailSettings(event) {
    event.preventDefault();
    setError('');
    setSavingEmailSettings(true);
    try {
      await api(`/api/games/${gameId}/email-settings`, {
        method: 'PUT',
        body: JSON.stringify(emailSettings),
      });

      setStatus('Email settings updated.');
      await loadGame();
    } catch (settingsError) {
      setError(settingsError.message);
    } finally {
      setSavingEmailSettings(false);
    }
  }

  async function sendManualEmail(event) {
    event.preventDefault();
    setError('');
    setSendingEmail(true);
    try {
      await api(`/api/games/${gameId}/email/manual`, {
        method: 'POST',
        body: JSON.stringify(manualEmail),
      });

      setManualEmail({ subject: '', message: '' });
      setStatus('Email sent to all players in this game.');
    } catch (emailError) {
      setError(emailError.message);
    } finally {
      setSendingEmail(false);
    }
  }

  async function sendReminder() {
    setError('');
    setRemindingPlayers(true);
    try {
      const data = await api(`/api/games/${gameId}/rounds/${game.activeRound.id}/remind`, {
        method: 'POST',
      });

      setStatus(
        data.remindedCount === 0
          ? 'Everyone has already submitted — no reminders needed.'
          : `Reminded ${data.remindedCount} player(s) with unanswered questions.`,
      );
    } catch (remindError) {
      setError(remindError.message);
    } finally {
      setRemindingPlayers(false);
    }
  }

  async function submitSuggestion(event) {
    event.preventDefault();
    setError('');
    setSubmittingSuggestion(true);
    try {
      await api(`/api/games/${gameId}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ prompt: suggestionPrompt }),
      });

      setSuggestionPrompt('');
      setStatus('Suggestion submitted. Thanks for the trivia!');
      await loadGame();
    } catch (suggestError) {
      setError(suggestError.message);
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
    } catch (dismissError) {
      setError(dismissError.message);
    } finally {
      setDismissingSuggestionId(null);
    }
  }

  async function promoteSuggestion(suggestion) {
    const options = game.draftRounds || [];
    const roundId = promoteTargets[suggestion.id] || options[0]?.id;
    if (!roundId) {
      setError('Create a draft round before promoting suggestions.');
      return;
    }

    setError('');
    setPromotingSuggestionId(suggestion.id);
    try {
      await api(`/api/games/${gameId}/suggestions/${suggestion.id}/promote`, {
        method: 'POST',
        body: JSON.stringify({ roundId }),
      });

      setStatus('Suggestion promoted into the draft round.');
      await loadGame();
    } catch (promoteError) {
      setError(promoteError.message);
    } finally {
      setPromotingSuggestionId(null);
    }
  }

  function toggleHour(value) {
    setEmailSettings((prev) => {
      const has = prev.expiringHours.includes(value);
      return {
        ...prev,
        expiringHours: has ? prev.expiringHours.filter((item) => item !== value) : [...prev.expiringHours, value],
      };
    });
  }

  if (error && !game) {
    return <div className="page"><p className="error" role="alert">{error}</p></div>;
  }

  if (!game) {
    return <div className="page"><p>Loading game...</p></div>;
  }

  const draftRounds = game.draftRounds || [];

  return (
    <div className="page stack-lg">
      <header className="row-between">
        <div>
          <h1>{game.name}</h1>
          <p>{game.description}</p>
          <p className="small">Game code: {game.code}</p>
        </div>
        <div className="row">
          <button className="button button-secondary" onClick={() => navigate('/dashboard')} type="button">Back</button>
        </div>
      </header>

      <nav className="tab-row">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`tab ${activeTab === tab ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'active' ? 'Active Round' : tab === 'leaderboard' ? 'Season Leaderboard' : tab === 'history' ? 'Past Rounds' : tab === 'share' ? 'Share' : tab === 'suggest' ? 'Suggest a Question' : 'Manage Game'}
          </button>
        ))}
      </nav>

      {activeTab === 'active' && (
        <section className="card stack">
          {!game.activeRound ? (
            <p>No active round right now. Stretch your fingers, greatness is coming.</p>
          ) : (
            <>
              <div className="row-between">
                <div>
                  <h2>{game.activeRound.name}</h2>
                  <p>{game.activeRound.description}</p>
                </div>
                <div className="stack stack-end">
                  <Countdown expiresAt={game.activeRound.expiresAt} onExpire={handleRoundExpire} />
                  {game.role === 'ADMIN' && !roundExpired && (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={sendReminder}
                      disabled={remindingPlayers}
                    >
                      {remindingPlayers ? 'Reminding...' : 'Remind pending players'}
                    </button>
                  )}
                </div>
              </div>

              {game.activeRound.questions.map((question) => (
                <label key={question.id} className="stack">
                  <strong>{question.prompt}</strong>
                  <input
                    value={answers[question.id] || ''}
                    onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                    placeholder="Your answer"
                    disabled={roundExpired}
                  />
                </label>
              ))}

              <button className="button" type="button" onClick={saveAnswers} disabled={roundExpired || savingAnswers}>
                {savingAnswers ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </section>
      )}

      {activeTab === 'leaderboard' && (
        <section className="card">
          <h2>Season Leaderboard</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Points</th>
                  <th>Medals</th>
                </tr>
              </thead>
              <tbody>
                {game.leaderboard.length === 0 ? (
                  <tr><td colSpan={4}>No scores yet.</td></tr>
                ) : (
                  game.leaderboard.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.rank}</td>
                      <td>{row.username}</td>
                      <td>{row.points}</td>
                      <td>{'🥇'.repeat(row.medals)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'history' && (
        <section className="card stack">
          <h2>Past Rounds</h2>
          {game.pastRounds.length === 0 ? <p>No closed rounds yet.</p> : game.pastRounds.map((round) => (
            <div key={round.id} className="list-item">
              <span>{round.name} • closed {dayjs(round.expiresAt).format('MMM D, YYYY h:mm A')}</span>
              <Link className="button button-secondary" to={`/games/${gameId}/rounds/${round.id}/results`}>Open results</Link>
            </div>
          ))}
        </section>
      )}

      {activeTab === 'share' && (
        <section className="card stack">
          <h2>Share this game</h2>
          <label className="stack">
            <strong>Invite URL</strong>
            <input readOnly value={game.inviteUrl} />
          </label>
          <label className="stack">
            <strong>Game code</strong>
            <input readOnly value={game.code} />
          </label>
        </section>
      )}

      {activeTab === 'suggest' && (
        <section className="stack-lg">
          <div className="card stack">
            <h2>Suggest a Question</h2>
            <form className="stack" onSubmit={submitSuggestion}>
              <textarea
                aria-label="Question suggestion"
                placeholder="What should we ask next round?"
                value={suggestionPrompt}
                onChange={(event) => setSuggestionPrompt(event.target.value)}
                maxLength={240}
                required
              />
              <button className="button" type="submit" disabled={submittingSuggestion}>
                {submittingSuggestion ? 'Submitting...' : 'Submit Suggestion'}
              </button>
            </form>
          </div>

          {game.role === 'ADMIN' && (
            <div className="card stack">
              <h2>Review Suggestions</h2>
              {suggestions.filter((suggestion) => suggestion.status === 'PENDING').length === 0 ? (
                <p>No pending suggestions right now.</p>
              ) : (
                suggestions
                  .filter((suggestion) => suggestion.status === 'PENDING')
                  .map((suggestion) => (
                    <div key={suggestion.id} className="list-item">
                      <div>
                        <p>{suggestion.prompt}</p>
                        <p className="small">Suggested by {suggestion.submittedBy?.username || 'Unknown'}</p>
                      </div>
                      <div className="row">
                        <select
                          aria-label={`Target draft round for suggestion: ${suggestion.prompt}`}
                          value={promoteTargets[suggestion.id] ?? draftRounds[0]?.id ?? ''}
                          onChange={(event) =>
                            setPromoteTargets((prev) => ({ ...prev, [suggestion.id]: event.target.value }))
                          }
                          disabled={draftRounds.length === 0}
                        >
                          {draftRounds.length === 0 ? (
                            <option value="">No draft rounds</option>
                          ) : (
                            draftRounds.map((round) => (
                              <option key={round.id} value={round.id}>{round.name}</option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => promoteSuggestion(suggestion)}
                          disabled={promotingSuggestionId === suggestion.id || draftRounds.length === 0}
                        >
                          {promotingSuggestionId === suggestion.id ? 'Promoting...' : 'Promote'}
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => dismissSuggestion(suggestion)}
                          disabled={dismissingSuggestionId === suggestion.id}
                        >
                          {dismissingSuggestionId === suggestion.id ? 'Dismissing...' : 'Dismiss'}
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          )}
        </section>
      )}

      {activeTab === 'manage' && game.role === 'ADMIN' && (
        <section className="grid-two">
          <div className="card stack">
            <h2>{editingRoundId ? 'Edit Draft Round' : 'Create Round'}</h2>
            <form className="stack" onSubmit={submitRoundForm}>
              <input aria-label="Round name" placeholder="Round name" value={roundForm.name} onChange={(event) => setRoundForm((prev) => ({ ...prev, name: event.target.value }))} required />
              <textarea aria-label="Round description" placeholder="Round description" value={roundForm.description} onChange={(event) => setRoundForm((prev) => ({ ...prev, description: event.target.value }))} />
              <label className="stack">
                <span>Start date/time</span>
                <input type="datetime-local" value={roundForm.startsAt} onChange={(event) => setRoundForm((prev) => ({ ...prev, startsAt: event.target.value }))} required />
              </label>
              <label className="stack">
                <span>Expiry date/time</span>
                <input type="datetime-local" value={roundForm.expiresAt} onChange={(event) => setRoundForm((prev) => ({ ...prev, expiresAt: event.target.value }))} required />
              </label>

              <div className="stack">
                <strong>Questions</strong>
                {roundForm.questions.map((question, index) => (
                  <div className="row question-row" key={index}>
                    <input
                      aria-label={`Question ${index + 1}`}
                      placeholder={`Question ${index + 1}`}
                      value={question}
                      onChange={(event) => {
                        const next = [...roundForm.questions];
                        next[index] = event.target.value;
                        setRoundForm((prev) => ({ ...prev, questions: next }));
                      }}
                      required
                    />
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-label={`Remove question ${index + 1}`}
                      onClick={() => {
                        setRoundForm((prev) => ({
                          ...prev,
                          questions: prev.questions.filter((_, qIndex) => qIndex !== index),
                        }));
                      }}
                      disabled={roundForm.questions.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" className="button button-secondary" onClick={() => setRoundForm((prev) => ({ ...prev, questions: [...prev.questions, ''] }))}>
                Add Question
              </button>
              <div className="row">
                <button type="submit" className="button" disabled={creatingRound}>
                  {creatingRound ? (editingRoundId ? 'Saving...' : 'Creating...') : (editingRoundId ? 'Save Changes' : 'Create Draft')}
                </button>
                {editingRoundId && (
                  <button type="button" className="button button-secondary" onClick={resetRoundForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card stack">
            <h2>Publish Round</h2>
            {draftRounds.length > 0 && (
              <div className="stack">
                <strong>Draft rounds</strong>
                {draftRounds.map((round) => (
                  <div key={round.id} className="list-item">
                    <span>{round.name}</span>
                    <div className="row">
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={`Edit ${round.name}`}
                        onClick={() => startEditRound(round)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={`Delete ${round.name}`}
                        onClick={() => deleteRound(round)}
                        disabled={deletingRoundId === round.id}
                      >
                        {deletingRoundId === round.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <form className="stack" onSubmit={publishRound}>
              <select value={draftToPublish} onChange={(event) => setDraftToPublish(event.target.value)}>
                <option value="">Select draft round</option>
                {draftRounds.map((round) => (
                  <option key={round.id} value={round.id}>{round.name}</option>
                ))}
              </select>
              <textarea
                placeholder="Release announcement email"
                value={announcement}
                onChange={(event) => setAnnouncement(event.target.value)}
                required
              />
              <button className="button" type="submit" disabled={publishing || !draftToPublish}>{publishing ? 'Publishing...' : 'Publish'}</button>
            </form>

            <h2>Email Automation</h2>
            <form className="stack" onSubmit={saveEmailSettings}>
              <label className="row">
                <input type="checkbox" checked={emailSettings.autoRoundOpen} onChange={(event) => setEmailSettings((prev) => ({ ...prev, autoRoundOpen: event.target.checked }))} />
                <span>Round open emails</span>
              </label>
              <label className="row">
                <input type="checkbox" checked={emailSettings.autoResultsLive} onChange={(event) => setEmailSettings((prev) => ({ ...prev, autoResultsLive: event.target.checked }))} />
                <span>Results live emails</span>
              </label>
              <div className="stack">
                <strong>Expiring soon reminders</strong>
                <label className="row"><input type="checkbox" checked={emailSettings.expiringHours.includes(24)} onChange={() => toggleHour(24)} /> 24 hours</label>
                <label className="row"><input type="checkbox" checked={emailSettings.expiringHours.includes(12)} onChange={() => toggleHour(12)} /> 12 hours</label>
                <label className="row"><input type="checkbox" checked={emailSettings.expiringHours.includes(6)} onChange={() => toggleHour(6)} /> 6 hours</label>
                <label className="row"><input type="checkbox" checked={emailSettings.expiringHours.includes(1)} onChange={() => toggleHour(1)} /> 1 hour</label>
              </div>
              <button className="button" type="submit" disabled={savingEmailSettings}>{savingEmailSettings ? 'Saving...' : 'Save Email Settings'}</button>
            </form>

            <h2>Manual Mass Email</h2>
            <form className="stack" onSubmit={sendManualEmail}>
              <input aria-label="Subject" placeholder="Subject" value={manualEmail.subject} onChange={(event) => setManualEmail((prev) => ({ ...prev, subject: event.target.value }))} required />
              <textarea aria-label="Message" placeholder="Message" value={manualEmail.message} onChange={(event) => setManualEmail((prev) => ({ ...prev, message: event.target.value }))} required />
              <button className="button" type="submit" disabled={sendingEmail}>{sendingEmail ? 'Sending...' : 'Send Email'}</button>
            </form>
          </div>
        </section>
      )}

      {status && <p className="success" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
