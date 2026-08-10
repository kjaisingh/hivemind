export default function PublishPanel({
  draftRounds,
  draftToPublish,
  setDraftToPublish,
  announcement,
  setAnnouncement,
  publishing,
  onPublish,
  onEditRound,
  onDeleteRound,
  deletingRoundId,
}) {
  return (
    <>
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
                  onClick={() => onEditRound(round)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`Delete ${round.name}`}
                  onClick={() => onDeleteRound(round)}
                  disabled={deletingRoundId === round.id}
                >
                  {deletingRoundId === round.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="stack" onSubmit={onPublish}>
        <select value={draftToPublish} onChange={(event) => setDraftToPublish(event.target.value)}>
          <option value="">Select draft round</option>
          {draftRounds.map((round) => (
            <option key={round.id} value={round.id}>
              {round.name}
            </option>
          ))}
        </select>
        <textarea
          placeholder="Release announcement email"
          value={announcement}
          onChange={(event) => setAnnouncement(event.target.value)}
          required
        />
        <button className="button" type="submit" disabled={publishing || !draftToPublish}>
          {publishing ? 'Publishing...' : 'Publish'}
        </button>
      </form>
    </>
  );
}
