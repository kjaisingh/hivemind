import RoundForm from './RoundForm';
import PublishPanel from './PublishPanel';
import EmailAutomationForm from './EmailAutomationForm';
import ManualEmailForm from './ManualEmailForm';

export default function ManageTab({
  roundForm,
  setRoundForm,
  editingRoundId,
  creatingRound,
  onSubmitRoundForm,
  onCancelEdit,
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
  emailSettings,
  setEmailSettings,
  onToggleHour,
  savingEmailSettings,
  onSaveEmailSettings,
  manualEmail,
  setManualEmail,
  sendingEmail,
  onSendManualEmail,
}) {
  return (
    <section className="grid-two" role="tabpanel" id="panel-manage" aria-labelledby="tab-manage">
      <RoundForm
        roundForm={roundForm}
        setRoundForm={setRoundForm}
        editingRoundId={editingRoundId}
        creatingRound={creatingRound}
        onSubmit={onSubmitRoundForm}
        onCancel={onCancelEdit}
      />

      <div className="card stack">
        <h2>Publish Round</h2>
        <PublishPanel
          draftRounds={draftRounds}
          draftToPublish={draftToPublish}
          setDraftToPublish={setDraftToPublish}
          announcement={announcement}
          setAnnouncement={setAnnouncement}
          publishing={publishing}
          onPublish={onPublish}
          onEditRound={onEditRound}
          onDeleteRound={onDeleteRound}
          deletingRoundId={deletingRoundId}
        />

        <h2>Email Automation</h2>
        <EmailAutomationForm
          emailSettings={emailSettings}
          setEmailSettings={setEmailSettings}
          onToggleHour={onToggleHour}
          savingEmailSettings={savingEmailSettings}
          onSubmit={onSaveEmailSettings}
        />

        <h2>Manual Mass Email</h2>
        <ManualEmailForm
          manualEmail={manualEmail}
          setManualEmail={setManualEmail}
          sendingEmail={sendingEmail}
          onSubmit={onSendManualEmail}
        />
      </div>
    </section>
  );
}
