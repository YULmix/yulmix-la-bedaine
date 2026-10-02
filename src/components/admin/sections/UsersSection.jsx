import { useEffect, useState } from 'react';
import fr from '../../../locales/fr.json';
import { supabase } from '../../../lib/supabase';
import { useEvents } from '../../../lib/events';
import { refreshAdminParties, updatePaymentStatus, useAdminParties } from '../../../lib/adminParties';
import { currentUserId as fetchCurrentUserId, setIsAdmin } from '../../../lib/profiles';
import { PAYMENT_STATUS, getPaymentStatusShortLabel } from '../../../lib/registrationOptions';
import { useToasts } from '../../../hooks/useToasts';
import AdminUserManagement from '../AdminUserManagement';
import PartyEditDialog from '../PartyEditDialog';
import UserProfileDialog from '../UserProfileDialog';
import { ConfirmDialog } from '../../ui';
import NoActiveEvent from './NoActiveEvent';
import SectionStatus from './SectionStatus';

// Inscrits (#195): the active event's parties, cancelled ones included. It owns its dialogs: the
// payment confirmation, a member's profile, the god-mode editor. Payment and admin changes reload
// the parties from the shared store.
const UsersSection = () => {
  const { activeEvent } = useEvents();
  const { parties, loading, error } = useAdminParties(activeEvent?.id);
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [editingParty, setEditingParty] = useState(null);
  // { party, newStatus } while the payment change waits for confirmation.
  const [pendingPayment, setPendingPayment] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const { addToast } = useToasts(1699);

  // Who is signed in, so the list doesn't offer to change one's own admin flag.
  useEffect(() => {
    let current = true;
    fetchCurrentUserId(supabase).then(id => { if (current) setCurrentUser(id); });
    return () => { current = false; };
  }, []);

  if (!activeEvent) return <NoActiveEvent />;
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={() => refreshAdminParties(activeEvent.id)} />;

  const handleAdminToggle = async (target, checked) => {
    try {
      await setIsAdmin(supabase, { profileId: target.id, isAdmin: checked, currentUser });
      addToast((checked ? fr.adminStatusEnabledToast : fr.adminStatusDisabledToast).replace('{email}', target.email), 'success');
      refreshAdminParties(activeEvent.id);
    } catch (err) {
      addToast(err.message, err.message === fr.selfAdminToggleError ? 'warning' : 'error');
    }
  };

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
        currentUserId={currentUser}
        onOpenUserProfile={setProfile}
        onAdminToggle={handleAdminToggle}
        onPaymentToggle={(party, newStatus) => setPendingPayment({ party, newStatus })}
        onEditParty={setEditingParty}
      />
      <UserProfileDialog profile={profile} onClose={() => setProfile(null)} />
      <PartyEditDialog party={editingParty} event={activeEvent} onClose={() => setEditingParty(null)} onSaved={handleSaved} />
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

export default UsersSection;
