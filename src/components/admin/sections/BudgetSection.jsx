import fr from '../../../locales/fr.json';
import { applyPricing, useEvents } from '../../../lib/events';
import { dbErrorMessage } from '../../../lib/dbErrors';
import { refreshAdminParties, useAdminParties } from '../../../lib/adminParties';
import { refreshBudget, saveBudget, setBudgetDraft, useBudget } from '../../../lib/budget';
import { useToasts } from '../../../hooks/useToasts';
import { useAdminAccess } from '../../../hooks/useAdminAccess';
import AdminBudget from '../AdminBudget';
import NoActiveEvent from './NoActiveEvent';
import SectionStatus from './SectionStatus';

// Budget (#195): the active event's budget, its unsaved edits (kept in the budget store, so they
// survive switching sections) and the pricing. Its numbers count the active parties.
const BudgetSection = () => {
  const { activeEvent } = useEvents();
  const eventId = activeEvent?.id;
  const { role } = useAdminAccess();
  const parties = useAdminParties(eventId, role);
  const { budget, draft, saving, loading, error } = useBudget(eventId);
  const { addToast } = useToasts(1699);

  if (!activeEvent) return <NoActiveEvent />;
  if (parties.loading || parties.error || loading || error) {
    return <SectionStatus loading={parties.loading || loading} error={parties.error || error} onRetry={() => { refreshAdminParties(eventId); refreshBudget(eventId); }} />;
  }

  const handleSave = async (lines, contingency) => {
    try {
      await saveBudget(eventId, lines, contingency);
      addToast(fr.budgetSavedToast, 'success');
    } catch (err) {
      addToast(dbErrorMessage(err, fr.saveError), 'error');
    }
  };

  // New base price and main-event ratio. Existing registrations keep the price they locked (#117);
  // only those made while the event had no price get it, so the parties reload.
  const handleApplyPricing = async (pricing) => {
    try {
      await applyPricing(eventId, pricing);
      addToast(fr.pricingAppliedToast, 'success');
      await refreshAdminParties(eventId);
    } catch (err) {
      addToast(dbErrorMessage(err, fr.updateError), 'error');
    }
  };

  return (
    <AdminBudget
      event={activeEvent}
      budget={budget}
      draft={draft}
      parties={parties.activeParties}
      onDraftChange={next => setBudgetDraft(eventId, next)}
      onSaveBudget={handleSave}
      savingBudget={saving}
      onApplyPricing={handleApplyPricing}
    />
  );
};

export default BudgetSection;
