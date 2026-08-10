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
      <form className="stack" onSubmit={onSubmit}>
        <input
          aria-label="Round name"
          placeholder="Round name"
          value={roundForm.name}
          onChange={(event) => setRoundForm((prev) => ({ ...prev, name: event.target.value }))}
          required
        />
        <textarea
          aria-label="Round description"
          placeholder="Round description"
          value={roundForm.description}
          onChange={(event) => setRoundForm((prev) => ({ ...prev, description: event.target.value }))}
        />
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

        <button type="button" className="button button-secondary" onClick={addQuestion}>
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
