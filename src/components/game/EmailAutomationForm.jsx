export default function EmailAutomationForm({ emailSettings, setEmailSettings, onToggleHour, savingEmailSettings, onSubmit }) {
  return (
    <form className="stack" onSubmit={onSubmit}>
      <label className="row">
        <input
          type="checkbox"
          checked={emailSettings.autoRoundOpen}
          onChange={(event) => setEmailSettings((prev) => ({ ...prev, autoRoundOpen: event.target.checked }))}
        />
        <span>Round open emails</span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={emailSettings.autoResultsLive}
          onChange={(event) => setEmailSettings((prev) => ({ ...prev, autoResultsLive: event.target.checked }))}
        />
        <span>Results live emails</span>
      </label>
      <div className="stack">
        <strong>Expiring soon reminders</strong>
        <label className="row">
          <input type="checkbox" checked={emailSettings.expiringHours.includes(24)} onChange={() => onToggleHour(24)} />
          24 hours
        </label>
        <label className="row">
          <input type="checkbox" checked={emailSettings.expiringHours.includes(12)} onChange={() => onToggleHour(12)} />
          12 hours
        </label>
        <label className="row">
          <input type="checkbox" checked={emailSettings.expiringHours.includes(6)} onChange={() => onToggleHour(6)} />
          6 hours
        </label>
        <label className="row">
          <input type="checkbox" checked={emailSettings.expiringHours.includes(1)} onChange={() => onToggleHour(1)} />
          1 hour
        </label>
      </div>
      <button className="button" type="submit" disabled={savingEmailSettings}>
        {savingEmailSettings ? 'Saving...' : 'Save Email Settings'}
      </button>
    </form>
  );
}
