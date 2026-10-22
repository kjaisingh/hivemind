import QuestionEditor from './QuestionEditor';

export default function RoundForm({ roundForm, setRoundForm, editingRoundId, creatingRound, onSubmit, onCancel }) {
  function setQuestions(next) {
    setRoundForm((prev) => ({ ...prev, questions: next }));
  }

  function addQuestion() {
    setQuestions([...roundForm.questions, { prompt: '', type: 'TEXT', choices: ['', ''] }]);
  }

  return (
    <div className="card stack">
      <h2>{editingRoundId ? 'Edit Draft Round' : 'Create Round'}</h2>
      <p className="small">Times use your local timezone. Save a draft, then publish it when you are ready. Rounds do not open automatically.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field stack-xs">
          <span>Round name</span>
          <input
            placeholder="Round name"
            maxLength={80}
            value={roundForm.name}
            onChange={(event) => setRoundForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>
        <label className="field stack-xs">
          <span>Round description <span className="small">(optional)</span></span>
          <textarea
            placeholder="Round description"
            maxLength={240}
            value={roundForm.description}
            onChange={(event) => setRoundForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </label>
        <label className="stack">
          <span>Start date/time</span>
          <input
            type="datetime-local"
            value={roundForm.startsAt}
            onChange={(event) => setRoundForm((prev) => ({ ...prev, startsAt: event.target.value }))}
            required
          />
        </label>
        <label className="stack">
          <span>Expiry date/time</span>
          <input
            type="datetime-local"
            value={roundForm.expiresAt}
            onChange={(event) => setRoundForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
            required
          />
        </label>

        <div className="stack">
          <strong>Questions</strong>
          {roundForm.questions.map((question, index) => (
            <QuestionEditor
              key={index}
              question={question}
              index={index}
              questions={roundForm.questions}
              setQuestions={setQuestions}
            />
          ))}
        </div>

        <button type="button" className="button button-secondary" onClick={addQuestion} disabled={roundForm.questions.length >= 20}>
          Add Question
        </button>
        <div className="row">
          <button type="submit" className="button" disabled={creatingRound}>
            {creatingRound ? (editingRoundId ? 'Saving...' : 'Creating...') : editingRoundId ? 'Save Changes' : 'Create Draft'}
          </button>
          {editingRoundId && (
            <button type="button" className="button button-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
