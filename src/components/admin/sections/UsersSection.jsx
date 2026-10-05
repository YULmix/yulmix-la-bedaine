import { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { supabase } from '../../../lib/supabase';
import { refreshEvents, useEvents } from '../../../lib/events';
import { refreshAdminParties, updatePaymentStatus, useAdminParties } from '../../../lib/adminParties';
import { PAYMENT_STATUS, getPaymentStatusShortLabel } from '../../../lib/registrationOptions';
import { useToasts } from '../../../hooks/useToasts';
import { useAdminAccess } from '../../../hooks/useAdminAccess';
import { can, organiserEditions } from '../../../lib/editionRoles';
import AdminUserManagement from '../AdminUserManagement';
import PartyDetailDialog from '../PartyDetailDialog';
import PartyEditDialog from '../PartyEditDialog';
import UserProfileDialog from '../UserProfileDialog';
import ParticipantsView from '../ParticipantsView';
import { ChangeHistory } from '../ChangeHistory';
import ExportDialog from '../ExportDialog';
import { ConfirmDialog, EmptyState } from '../../ui';
import NoActiveEvent from './NoActiveEvent';
import { openVoirComme } from '../../../lib/voirComme';
import SectionStatus from './SectionStatus';

// Inscrits (#195, #209): « Liste », the active event's parties, cancelled ones included, and
// « Historique », the change history of an event's registrations (/admin/users/history). The
// header's « Exporter » is on the list only: the history has its own export buttons. The list owns its dialogs: the payment confirmation, a
// member's profile, the god-mode editor. Payment changes reload the parties from the
// shared store. What the role doesn't allow isn't there (#217, ADR 0023): Comité reads the list
// without amounts nor payments (#290, ADR 0026),
// Organisateur also marks payments, and only an admin edits a registration (the admin flag is in « Équipe »).
const UsersList = ({ addToast }) => {
  const { role, isAdmin } = useAdminAccess();
  const canEdit = can(role, 'editRegistration');
  const seeFinances = can(role, 'seeFinances');
  const { activeEvent } = useEvents();
  const { parties, loading, error } = useAdminParties(activeEvent?.id, role);
  const [profile, setProfile] = useState(null);
  // The registration open read-only (by id, so it follows a refresh) and the one in the editor.
  const [viewingId, setViewingId] = useState(null);
  const [editingParty, setEditingParty] = useState(null);
  // { party, newStatus } while the payment change waits for confirmation.
  const [pendingPayment, setPendingPayment] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  if (!activeEvent) return <NoActiveEvent />;
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={() => refreshAdminParties(activeEvent.id)} />;

  const confirmPaymentToggle = async () => {
    if (!pendingPayment) return;
    const { party, newStatus } = pendingPayment;
    setConfirmBusy(true);
    try {
      await updatePaymentStatus(party, newStatus);
      addToast(fr.paymentStatusUpdatedToast.replace('{action}', getPaymentStatusShortLabel(newStatus)), 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setConfirmBusy(false);
      setPendingPayment(null);
    }
  };

  const handleSaved = () => {
    addToast(fr.changesSavedToast, 'success');
    setEditingParty(null);
    refreshAdminParties(activeEvent.id);
  };

  const paymentLabel = pendingPayment?.newStatus === PAYMENT_STATUS.PAID ? fr.markPaid : fr.markUnpaid;

  return (
    <>
      <AdminUserManagement
        parties={parties}
        onOpenParty={party => setViewingId(party.id)}
        onPaymentToggle={can(role, 'markPayment') ? (party, newStatus) => setPendingPayment({ party, newStatus }) : undefined}
        showFinances={seeFinances}
      />
      <PartyDetailDialog
        party={parties.find(party => party.id === viewingId) || null}
        onClose={() => setViewingId(null)}
        onViewProfile={setProfile}
        onEdit={canEdit ? party => { setViewingId(null); setEditingParty(party); } : undefined}
        onViewAs={isAdmin ? profile => openVoirComme(profile.id) : undefined}
        showEmailLog={can(role, 'emailLog')}
        showFinances={seeFinances}
      />
      <UserProfileDialog profile={profile} onClose={() => setProfile(null)} showFinances={seeFinances} event={activeEvent} parties={parties} />
      {canEdit && <PartyEditDialog party={editingParty} event={activeEvent} onClose={() => setEditingParty(null)} onSaved={handleSaved} />}
      <ConfirmDialog
        open={!!pendingPayment}
        tone="primary"
        title={paymentLabel}
        confirmLabel={paymentLabel}
        onConfirm={confirmPaymentToggle}
        onCancel={() => setPendingPayment(null)}
        loading={confirmBusy}
      >
        {pendingPayment && fr.paymentToggleConfirm
          .replace('{action}', getPaymentStatusShortLabel(pendingPayment.newStatus))
          .replace('{name}', pendingPayment.party.profiles?.full_name || fr.defaultUserFallback)}
      </ConfirmDialog>
    </>
  );
};

// The editions offered are those whose history the person may read: every one for an admin, else
// those they are Organisateur of, past ones included (ADR 0023).
const HistoryView = ({ addToast }) => {
  const { isAdmin, roles } = useAdminAccess();
  const { events: allEvents, loading, error } = useEvents();
  const events = useMemo(() => organiserEditions(allEvents, { isAdmin, roles }), [allEvents, isAdmin, roles]);
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  return events.length > 0
    ? <ChangeHistory events={events} notify={addToast} />
    : <EmptyState icon={History} title={fr.changeHistoryEmpty} />;
};

// Comité reads the attendees as it reads the list (RLS); the view is read-only.
const ParticipantsPage = () => {
  const { role } = useAdminAccess();
  const { activeEvent } = useEvents();
  const { activeParties, loading, error } = useAdminParties(activeEvent?.id, role);
  if (!activeEvent) return <NoActiveEvent />;
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={() => refreshAdminParties(activeEvent.id)} />;
  return <ParticipantsView parties={activeParties} />;
};

const UsersSection = ({ view }) => {
  const { addToast } = useToasts(1699);
  const { role } = useAdminAccess();
  const { activeEvent } = useEvents();
  const { activeParties } = useAdminParties(activeEvent?.id, role);
  return (
    <>
      {activeEvent && view === 'list' && can(role, 'exportData') && <ExportDialog event={activeEvent} parties={activeParties} addToast={addToast} />}
      {view === 'history' ? <HistoryView addToast={addToast} /> : view === 'participants' ? <ParticipantsPage /> : <UsersList addToast={addToast} />}
    </>
  );
};

export default UsersSection;
