export default function QuestionEditor({ question, index, questions, setQuestions }) {
  function updateQuestion(patch) {
    const next = [...questions];
    next[index] = { ...next[index], ...patch };
    setQuestions(next);
  }

  function updateChoice(choiceIndex, value) {
    const nextChoices = [...question.choices];
    nextChoices[choiceIndex] = value;
    updateQuestion({ choices: nextChoices });
  }

  function removeChoice(choiceIndex) {
    updateQuestion({ choices: question.choices.filter((_, cIndex) => cIndex !== choiceIndex) });
  }

  function addChoice() {
    updateQuestion({ choices: [...question.choices, ''] });
  }

  function removeQuestion() {
    setQuestions(questions.filter((_, qIndex) => qIndex !== index));
  }

  return (
    <div className="stack question-block">
      <div className="row question-row">
        <input
          aria-label={`Question ${index + 1}`}
          placeholder={`Question ${index + 1}`}
          value={question.prompt}
          onChange={(event) => updateQuestion({ prompt: event.target.value })}
          required
        />
        <select
          aria-label={`Question ${index + 1} type`}
          value={question.type}
          onChange={(event) => updateQuestion({ type: event.target.value })}
        >
          <option value="TEXT">Free text</option>
          <option value="MULTIPLE_CHOICE">Multiple choice</option>
        </select>
        <button
          type="button"
          className="button button-secondary"
          aria-label={`Remove question ${index + 1}`}
          onClick={removeQuestion}
          disabled={questions.length <= 1}
        >
          Remove
        </button>
      </div>

      {question.type === 'MULTIPLE_CHOICE' && (
        <div className="stack choice-list">
          {question.choices.map((choice, choiceIndex) => (
            <div className="row" key={choiceIndex}>
              <input
                aria-label={`Question ${index + 1} choice ${choiceIndex + 1}`}
                placeholder={`Choice ${choiceIndex + 1}`}
                value={choice}
                onChange={(event) => updateChoice(choiceIndex, event.target.value)}
                required
              />
              <button
                type="button"
                className="button button-secondary"
                aria-label={`Remove choice ${choiceIndex + 1} from question ${index + 1}`}
                onClick={() => removeChoice(choiceIndex)}
                disabled={question.choices.length <= 2}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button-secondary"
            onClick={addChoice}
            disabled={question.choices.length >= 8}
          >
            Add Choice
          </button>
        </div>
      )}
    </div>
  );
}
