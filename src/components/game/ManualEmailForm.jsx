export default function ManualEmailForm({ manualEmail, setManualEmail, sendingEmail, onSubmit }) {
  return (
    <form className="stack" onSubmit={onSubmit}>
      <input
        aria-label="Subject"
        placeholder="Subject"
        value={manualEmail.subject}
        onChange={(event) => setManualEmail((prev) => ({ ...prev, subject: event.target.value }))}
        required
      />
      <textarea
        aria-label="Message"
        placeholder="Message"
        value={manualEmail.message}
        onChange={(event) => setManualEmail((prev) => ({ ...prev, message: event.target.value }))}
        required
      />
      <button className="button" type="submit" disabled={sendingEmail}>
        {sendingEmail ? 'Sending...' : 'Send Email'}
      </button>
    </form>
  );
}
