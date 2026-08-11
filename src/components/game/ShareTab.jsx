export default function ShareTab({ game, qrDataUrl, copiedField, onCopy }) {
  return (
    <section className="card stack" role="tabpanel" id="panel-share" aria-labelledby="tab-share">
      <h2>Share this game</h2>
      <p className="small">
        Anyone with the invite link joins instantly if they&apos;re already signed in to Hivemind. Otherwise
        they&apos;ll be asked to sign in or create an account first.
      </p>
      <label className="stack">
        <strong>Invite link</strong>
        <div className="row">
          <input readOnly value={game.inviteUrl} />
          <button className="button button-secondary" type="button" onClick={() => onCopy(game.inviteUrl, 'url')}>
            {copiedField === 'url' ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </label>
      <label className="stack">
        <strong>Game code</strong>
        <div className="row">
          <input readOnly value={game.code} />
          <button className="button button-secondary" type="button" onClick={() => onCopy(game.code, 'code')}>
            {copiedField === 'code' ? 'Copied!' : 'Copy code'}
          </button>
        </div>
      </label>
      {qrDataUrl && (
        <div className="stack qr-share">
          <strong>Scan to join</strong>
          <img src={qrDataUrl} alt="QR code to join this game" className="qr-code" />
        </div>
      )}
    </section>
  );
}
