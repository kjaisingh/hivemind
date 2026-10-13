import Countdown from './Countdown';

export default function ActiveRoundTab({
  game,
  answers,
  setAnswers,
  answersDirty,
  progress,
  roundExpired,
  onExpire,
  savingAnswers,
  onSave,
  remindingPlayers,
  onRemind,
}) {
  return (
    <section className="card stack" role="tabpanel" id="panel-active" aria-labelledby="tab-active">
      {!game.activeRound ? (
        <p>No active round right now. Stretch your fingers, greatness is coming.</p>
      ) : (
        <>
          <div className="row-between">
            <div>
            <h2>{game.activeRound.name}</h2>
            <p>{game.activeRound.description}</p>
            {progress && (
              <p className="small" aria-live="polite">
                {progress.submittedCount} of {progress.totalCount} players submitted
              </p>
            )}
            </div>
            <div className="stack stack-end">
              <Countdown expiresAt={game.activeRound.expiresAt} onExpire={onExpire} />
              {game.role === 'ADMIN' && !roundExpired && (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={onRemind}
                  disabled={remindingPlayers || !game.emailConfigured}
                  title={!game.emailConfigured ? 'Configure Resend to send email reminders.' : undefined}
                >
                  {!game.emailConfigured ? 'Email not configured' : remindingPlayers ? 'Reminding...' : 'Remind pending players'}
                </button>
              )}
            </div>
          </div>

          {game.activeRound.questions.map((question) => (
            <div key={question.id} className="stack">
              <strong>{question.prompt}</strong>
              {question.type === 'MULTIPLE_CHOICE' ? (
                <div className="stack choice-options" role="radiogroup" aria-label={question.prompt}>
                  {(question.choices || []).map((choice) => (
                    <label className="row choice-option" key={choice}>
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        value={choice}
                        checked={answers[question.id] === choice}
                        onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: choice }))}
                        disabled={roundExpired || savingAnswers}
                      />
                      <span>{choice}</span>
                    </label>
                  ))}
                  {answers[question.id] && (
                    <button
                      className="link clear-answer"
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: '' }))}
                      disabled={roundExpired || savingAnswers}
                    >
                      Clear answer
                    </button>
                  )}
                </div>
              ) : (
                <input
                  aria-label={question.prompt}
                  value={answers[question.id] || ''}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  placeholder="Your answer"
                  maxLength={500}
                  disabled={roundExpired || savingAnswers}
                />
              )}
            </div>
          ))}

          <div className="answer-actions row-between">
            <p className="small">
              {Object.values(answers).filter((answer) => answer.trim()).length} of {game.activeRound.questions.length} answered
              {' · '}{answersDirty ? 'Unsaved changes' : 'Saved'}
            </p>
            <button className="button" type="button" onClick={onSave} disabled={roundExpired || savingAnswers || !answersDirty}>
              {savingAnswers ? 'Saving...' : roundExpired ? 'Round closed' : 'Save Answers'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
