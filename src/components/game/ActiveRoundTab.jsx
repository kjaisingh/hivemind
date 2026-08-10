import Countdown from './Countdown';

export default function ActiveRoundTab({
  game,
  answers,
  setAnswers,
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
            </div>
            <div className="stack stack-end">
              <Countdown expiresAt={game.activeRound.expiresAt} onExpire={onExpire} />
              {game.role === 'ADMIN' && !roundExpired && (
                <button className="button button-secondary" type="button" onClick={onRemind} disabled={remindingPlayers}>
                  {remindingPlayers ? 'Reminding...' : 'Remind pending players'}
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
                        disabled={roundExpired}
                      />
                      <span>{choice}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  value={answers[question.id] || ''}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  placeholder="Your answer"
                  disabled={roundExpired}
                />
              )}
            </div>
          ))}

          <button className="button" type="button" onClick={onSave} disabled={roundExpired || savingAnswers}>
            {savingAnswers ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
    </section>
  );
}
