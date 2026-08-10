export default function SuggestTab({
  game,
  suggestions,
  suggestionPrompt,
  setSuggestionPrompt,
  onSubmitSuggestion,
  submittingSuggestion,
  draftRounds,
  promoteTargets,
  setPromoteTargets,
  onPromote,
  onDismiss,
  promotingSuggestionId,
  dismissingSuggestionId,
}) {
  const pending = suggestions.filter((suggestion) => suggestion.status === 'PENDING');

  return (
    <section className="stack-lg" role="tabpanel" id="panel-suggest" aria-labelledby="tab-suggest">
      <div className="card stack">
        <h2>Suggest a Question</h2>
        <form className="stack" onSubmit={onSubmitSuggestion}>
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
          {pending.length === 0 ? (
            <p>No pending suggestions right now.</p>
          ) : (
            pending.map((suggestion) => (
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
                        <option key={round.id} value={round.id}>
                          {round.name}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => onPromote(suggestion)}
                    disabled={promotingSuggestionId === suggestion.id || draftRounds.length === 0}
                  >
                    {promotingSuggestionId === suggestion.id ? 'Promoting...' : 'Promote'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => onDismiss(suggestion)}
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
  );
}
