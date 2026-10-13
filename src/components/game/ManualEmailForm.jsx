export default function ManualEmailForm({ manualEmail, setManualEmail, sendingEmail, emailConfigured, onSubmit }) {
  return (
    <form className="stack" onSubmit={onSubmit}>
      <label className="field stack-xs">
        <span>Subject</span>
        <input
          placeholder="Subject"
          maxLength={200}
          value={manualEmail.subject}
          onChange={(event) => setManualEmail((prev) => ({ ...prev, subject: event.target.value }))}
          required
        />
      </label>
      <label className="field stack-xs">
        <span>Message</span>
        <textarea
          placeholder="Message"
          maxLength={5000}
          value={manualEmail.message}
          onChange={(event) => setManualEmail((prev) => ({ ...prev, message: event.target.value }))}
          required
        />
      </label>
      <button className="button" type="submit" disabled={sendingEmail || !emailConfigured}>
        {!emailConfigured ? 'Email not configured' : sendingEmail ? 'Sending...' : 'Send Email'}
      </button>
    </form>
  );
}
