import { useState, useEffect, useMemo } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { Banknote, CalendarRange, ClipboardList, BedDouble, Download, History, Inbox, LayoutDashboard, MapPin, RotateCw, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ADMIN_SECTIONS, TOOLS_VIEW_IDS, adminHref, adminRedirect, adminRoute, isAdminPath, parseAdminLocation } from '../lib/adminRoutes';
import fr from '../locales/fr.json';
import RegistrationForm from '../components/RegistrationForm';
import AdminOverview from '../components/admin/AdminOverview';
import AdminLogisticsView from '../components/admin/AdminLogisticsView';
import AdminUserManagement from '../components/admin/AdminUserManagement';
import AdminBudget from '../components/admin/AdminBudget';
import { AdminEventList } from '../components/admin/AdminEvents';
import { AdminVenues } from '../components/admin/AdminVenues';
import EventEditor from '../components/admin/EventEditor';
import { ChangeHistory, DataExport, FeedbackInbox } from '../components/admin/AdminTools';
import UserProfileDialog from '../components/admin/UserProfileDialog';
import PartyEmailLog from '../components/admin/PartyEmailLog';
import { Button, ConfirmDialog, Dialog, EmptyState, Notice, Skeleton, ViewPanel, ViewTabs, cx } from '../components/ui';
import {
  PAYMENT_STATUS,
  getPaymentStatusShortLabel,
  isActiveRegistration
} from '../lib/registrationOptions';
import { EXPORTS, exportFileName, toCsv, toTsv } from '../lib/dataExport';
import { listEventParties, setPaymentStatus } from '../lib/parties';
import { useEventPlaces } from '../lib/eventPlaces';
import { countChanges, draftAfterSave, logisticsPayload, setNotesChange, setPlaceChange } from '../lib/logisticsDraft';
import { activateEvent, applyPricing, archiveEvent, refreshEvents, saveEventChanges, useEvents } from '../lib/events';
import { appError, dbErrorMessage } from '../lib/dbErrors';
import { dirtyFields, loadStoredDraft, storeDraft, validateDraft } from '../lib/eventDraft';
import { useToasts } from '../hooks/useToasts';

// Admin sub-navigation tabs, in the order and with the ids of the admin routes module (ADR 0022);
// the id is the URL's first segment, /admin/<id>.
const TAB_DISPLAY = {
  overview: { labelKey: 'adminTabOverview', shortKey: 'adminTabOverviewShort', icon: LayoutDashboard },
  users: { labelKey: 'adminTabUsers', shortKey: 'adminTabUsersShort', icon: ClipboardList },
  logistics: { labelKey: 'adminTabLogistics', shortKey: 'adminTabLogisticsShort', icon: BedDouble },
  budget: { labelKey: 'adminTabBudget', shortKey: 'adminTabBudgetShort', icon: Banknote },
  events: { labelKey: 'adminTabEvents', shortKey: 'adminTabEventsShort', icon: CalendarRange },
  venues: { labelKey: 'adminTabVenues', shortKey: 'adminTabVenuesShort', icon: MapPin },
  tools: { labelKey: 'adminTabTools', shortKey: 'adminTabToolsShort', icon: Wrench }
};
const ADMIN_TABS = ADMIN_SECTIONS.map(id => ({ id, ...TAB_DISPLAY[id] }));

// The Outils tab's views (/admin/tools/<view>), one job each, so the change history (#173) can
// have the screen to itself; the first is the default.
const TOOLS_VIEW_DISPLAY = {
  exports: { labelKey: 'toolsViewExports', icon: Download },
  history: { labelKey: 'toolsViewHistory', icon: History },
  feedback: { labelKey: 'toolsViewFeedback', icon: Inbox }
};
const TOOLS_VIEWS = TOOLS_VIEW_IDS.map(id => ({ id, ...TOOLS_VIEW_DISPLAY[id] }));

const AdminView = ({ isAdmin }) => {
  const location = useLocation();
  const navigate = useNavigate();
  // Where we are, from the URL (src/lib/adminRoutes.ts). The event editor, /admin/events/:id, is
  // under the same admin shell: the Événements tab stays selected and this component stays mounted.
  const route = parseAdminLocation(location.pathname, location.search);
  const activeTab = route.section;
  const editEventId = route.section === 'events' ? route.eventId : null;
  const editSection = route.section === 'events' ? route.editorSection : 'details';
  const logisticsView = route.section === 'logistics' ? route.view : null;
  const toolsView = route.section === 'tools' ? route.view : null;
  // Old query-param links (/admin?tab=…) and paths that aren't canonical go to the canonical one,
  // replacing it in the history so Back doesn't bounce.
  useEffect(() => {
    const target = adminRedirect(location.pathname, location.search);
    if (target) navigate(target, { replace: true });
  }, [location.pathname, location.search, navigate]);
  // Moving to another route pushes a history entry, so Back walks back through tabs, views and
  // editor sections.
  const go = (to) => navigate(adminHref(to));
  const selectTab = (tabId) => go(adminRoute(tabId));
  // The events and the active one come from the store the member pages read too (src/lib/events.ts,
  // #195): a change made here shows there without a reload (#192).
  const { events, activeEvent: activeEventState } = useEvents();
  const [parties, setParties] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingParty, setEditingParty] = useState(null);
  // Unsaved edits to the event open in the editor: { eventId, changes, restored }. Kept here (and in
  // sessionStorage) so they survive switching tabs and sections, and reloads.
  const [eventDraft, setEventDraft] = useState(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const { addToast } = useToasts(1699);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [realtimeChannel, setRealtimeChannel] = useState(null);
  const [userProfileModal, setUserProfileModal] = useState(null);
  const [userEventHistory, setUserEventHistory] = useState([]);
  // The Logistique tab's unsaved places and notes (lib/logisticsDraft.js), why the last save
  // refused a party ({ [partyId]: French message }), and whether a save is running (#150).
  const [logisticsChanges, setLogisticsChanges] = useState({});
  const [logisticsErrors, setLogisticsErrors] = useState({});
  const [savingLogistics, setSavingLogistics] = useState(false);
  // The active event's admin-only budget (event_budgets row, null if never saved) and its unsaved
  // edits, kept here so they survive switching tabs.
  const [budget, setBudget] = useState(null);
  const [budgetDraft, setBudgetDraft] = useState(null);
  const [savingBudget, setSavingBudget] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [showResolvedFeedback, setShowResolvedFeedback] = useState(false);
  const [pendingPayment, setPendingPayment] = useState(null);
  const [pendingArchive, setPendingArchive] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Fetch all events, parties, profiles
  useEffect(() => {
    if (!isAdmin) return;
    fetchAllData();
    return () => {
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
      }
    };
  }, [isAdmin]);

  // Get current user ID for admin toggle
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id || null);
    });
  }, []);

  // Subscribe to real-time changes for active event's parties
  useEffect(() => {
    if (!activeEventState?.id || !isAdmin) return;
    const channel = supabase.channel(`admin_parties_${activeEventState.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_parties',
        filter: `event_id=eq.${activeEventState.id}`
      }, () => {
        fetchParties(activeEventState.id);
      })
      .subscribe();
    setRealtimeChannel(channel);
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeEventState?.id, isAdmin]);

  // The active event's sleeping places as it uses them (#113, #193), for Aperçu's occupancy (#115)
  // and the Logistique tab's picker: shared with the event editor, so its changes show here.
  const { available: places } = useEventPlaces(activeEventState?.id);

  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      // The events again, fresh for the admin; then the active event's data.
      const { activeEvent: activeEv, error: eventsError } = await refreshEvents();
      if (eventsError) throw appError(eventsError);
      if (activeEv) {
        await Promise.all([fetchParties(activeEv.id), fetchBudget(activeEv.id)]);
      }

      // Fetch all profiles for admin checkbox
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name, is_admin')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (profilesError) throw profilesError;
      setProfiles(profilesData || []);

      await fetchFeedback();
    } catch (err) {
      console.error('Error fetching admin data:', err);
      setError(dbErrorMessage(err, fr.loadErrorHint));
    } finally {
      setLoading(false);
    }
  };

  const fetchFeedback = async () => {
    try {
      const { data: feedbackData, error: feedbackError } = await supabase
        .from('app_feedback')
        .select('*, profiles(email, full_name)')
        .order('created_at', { ascending: false });
      if (feedbackError) throw feedbackError;
      setFeedbackItems(feedbackData || []);
    } catch (err) {
      console.error('Error fetching feedback:', err);
    }
  };

  const handleResolveFeedback = async (feedbackId) => {
    try {
      const { error: resolveError } = await supabase
        .from('app_feedback')
        .update({ is_resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', feedbackId);
      if (resolveError) throw resolveError;
      addToast(fr.adminFeedbackResolve, 'success');
      fetchFeedback();
    } catch (err) {
      console.error('Error resolving feedback:', err);
      addToast(dbErrorMessage(err, fr.error), 'error');
    }
  };

  const fetchBudget = async (eventId) => {
    const { data, error: budgetError } = await supabase
      .from('event_budgets')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle();
    if (budgetError) throw budgetError;
    setBudget(data);
    // A draft belongs to one event: drop it if another event became the active one.
    setBudgetDraft(prev => (prev?.eventId === eventId ? prev : null));
  };

  // Lines and contingency go to event_budgets; the database checks them and computes the total.
  const saveBudget = async (lines, contingency) => {
    setSavingBudget(true);
    try {
      const { data, error: saveError } = await supabase
        .from('event_budgets')
        .upsert({
          event_id: activeEventState.id,
          lines: lines.map(line => ({
            category: line.category,
            description: (line.description || '').trim(),
            amount: Math.max(Number(line.amount) || 0, 0)
          })),
          contingency_pct: Math.min(Math.max(Number(contingency) || 0, 0), 100)
        })
        .select()
        .single();
      if (saveError) throw saveError;
      setBudget(data);
      setBudgetDraft(null);
      addToast(fr.budgetSavedToast, 'success');
    } catch (err) {
      console.error('Error saving budget:', err);
      addToast(fr.saveError, 'error');
    } finally {
      setSavingBudget(false);
    }
  };

  // New base price and main-event ratio. Existing registrations keep the price they locked (#117);
  // only those made while the event had no price get it.
  const handleApplyPricing = async (pricing) => {
    try {
      await applyPricing(activeEventState.id, pricing);
      addToast(fr.pricingAppliedToast, 'success');
      await fetchAllData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const fetchParties = async (eventId) => {
    try {
      setParties(await listEventParties(supabase, eventId));
    } catch (err) {
      setError(err.message);
    }
  };

  // Only one event can be active: the events store checks, and so does the database.
  const handleActivateEvent = async (event) => {
    try {
      await activateEvent(event);
      addToast(fr.eventActivatedToast.replace('{theme}', event.theme), 'success');
      fetchAllData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const confirmArchiveEvent = async () => {
    const event = pendingArchive;
    if (!event) return;
    setConfirmBusy(true);
    try {
      await archiveEvent(event);
      addToast(fr.eventArchivedToast.replace('{theme}', event.theme), 'success');
      fetchAllData();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setConfirmBusy(false);
      setPendingArchive(null);
    }
  };

  const editingEvent = editEventId ? events.find(event => event.id === editEventId) : null;
  const eventChanges = eventDraft?.eventId === editEventId ? eventDraft.changes : {};
  const eventDirty = editingEvent ? dirtyFields(editingEvent, eventChanges) : [];
  const eventErrors = validateDraft(editingEvent, eventChanges);

  // Opening an event picks up a draft left in sessionStorage (a reload, a closed tab…).
  useEffect(() => {
    if (!editEventId || eventDraft?.eventId === editEventId) return;
    const stored = loadStoredDraft(editEventId);
    setEventDraft({ eventId: editEventId, changes: stored || {}, restored: !!stored });
  }, [editEventId, eventDraft?.eventId]);

  useEffect(() => {
    if (eventDraft) storeDraft(eventDraft.eventId, eventDraft.changes);
  }, [eventDraft]);

  // Closing or reloading the browser tab with unsaved edits asks first. (The event editor's would
  // be restored from sessionStorage on a reload, but not in a new tab; the Logistique tab's live
  // only here.)
  const hasUnsavedEvent = !!eventDraft && events.some(event => event.id === eventDraft.eventId && dirtyFields(event, eventDraft.changes).length > 0);
  const unsavedLogistics = countChanges(logisticsChanges);
  useEffect(() => {
    if (!hasUnsavedEvent && !unsavedLogistics) return;
    const warn = (event) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedEvent, unsavedLogistics]);

  // Leaving the admin pages in the app drops the Logistique draft with this component, so it asks
  // too (#150). Moving between admin tabs keeps the draft and doesn't ask.
  const leaveBlocker = useBlocker(({ nextLocation }) => unsavedLogistics > 0 && !isAdminPath(nextLocation.pathname));

  const handleEventFieldChange = (field, value) => {
    setEventDraft(prev => ({ ...prev, eventId: editEventId, changes: { ...(prev?.eventId === editEventId ? prev.changes : {}), [field]: value } }));
  };

  const discardEventChanges = () => setEventDraft({ eventId: editEventId, changes: {}, restored: false });

  const handleSaveEventChanges = async () => {
    if (!editingEvent || !eventDirty.length || Object.keys(eventErrors).length) return;
    setSavingEvent(true);
    try {
      await saveEventChanges(editingEvent, eventChanges);
      discardEventChanges();
      addToast(fr.eventMetadataUpdatedToast, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSavingEvent(false);
    }
  };

  // Admin checkbox toggle (prevent self-escalation)
  const handleAdminToggle = async (profile, checked) => {
    if (profile.id === currentUserId) {
      addToast(fr.selfAdminToggleError, 'warning');
      return;
    }
    try {
      const { error } = await supabase.rpc('admin_set_is_admin', {
        target_user_id: profile.id,
        new_is_admin: checked
      });
      if (error) throw error;
      addToast(
        (checked ? fr.adminStatusEnabledToast : fr.adminStatusDisabledToast).replace('{email}', profile.email),
        'success'
      );
      fetchAllData();
    } catch (err) {
      console.error('Error updating admin status:', err);
      if (err.code === 'PGRST202') {
        addToast(fr.adminToggleNotDeployedError, 'error');
      } else {
        addToast(dbErrorMessage(err, fr.updateError), 'error');
      }
    }
  };

  // Payment status toggle: asks for confirmation in a dialog (pendingPayment), then writes.
  const handlePaymentToggle = (party, newStatus) => {
    setPendingPayment({ party, newStatus });
  };

  const confirmPaymentToggle = async () => {
    if (!pendingPayment) return;
    const { party, newStatus } = pendingPayment;
    const action = getPaymentStatusShortLabel(newStatus);
    setConfirmBusy(true);
    try {
      await setPaymentStatus(supabase, party.id, newStatus);
      addToast(fr.paymentStatusUpdatedToast.replace('{action}', action), 'success');
      fetchParties(activeEventState.id);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setConfirmBusy(false);
      setPendingPayment(null);
    }
  };

  // God-Mode editing: open RegistrationForm pre-filled with the exact attendees array
  const openPartyEdit = (party) => {
    setEditingParty(party);
  };

  const closePartyEdit = () => {
    setEditingParty(null);
  };

  const handleAdminSave = async () => {
    addToast(fr.changesSavedToast, 'success');
    closePartyEdit();
    fetchParties(activeEventState.id);
  };


  // Cancelled parties owe nothing and count for nothing (no refunds, #101). Only the users tab
  // (its "Annulées" filter) and the god-mode edit still see them; everything else uses this.
  const activeParties = useMemo(() => parties.filter(isActiveRegistration), [parties]);

  // User profile modal functions
  const openUserProfile = async (profile) => {
    setUserProfileModal(profile);
    try {
      // Fetch user event history
      const { data: history, error } = await supabase
        .from('user_event_history')
        .select('*')
        .eq('user_id', profile.id)
        .order('registration_date', { ascending: false });
      
      if (error) throw error;
      setUserEventHistory(history || []);
    } catch (err) {
      console.error('Error fetching user event history:', err);
      addToast(fr.historyFetchError, 'error');
      setUserEventHistory([]);
    }
  };

  const closeUserProfile = () => {
    setUserProfileModal(null);
    setUserEventHistory([]);
  };

  // Logistics updates: edits stay a draft until the one Save (#150).
  const handleAdminNotesChange = (party, value) => setLogisticsChanges(prev => setNotesChange(prev, party, value));

  // placeId: a place id, or null to unassign.
  const handlePlaceChange = (party, attendeeId, placeId) => setLogisticsChanges(prev => setPlaceChange(prev, party, attendeeId, placeId));

  const discardLogisticsChanges = () => {
    setLogisticsChanges({});
    setLogisticsErrors({});
  };

  // One call, each party saved entirely or not at all (save_logistics). Refused parties keep their
  // draft and show why; the others are cleared.
  const saveLogisticsChanges = async () => {
    const sent = logisticsChanges;
    if (!Object.keys(sent).length) return;
    setSavingLogistics(true);
    try {
      const { data: failures, error } = await supabase.rpc('save_logistics', { p_changes: logisticsPayload(sent) });
      if (error) throw error;

      await fetchParties(activeEventState.id);
      setLogisticsChanges(current => draftAfterSave(current, sent, failures.map(failure => failure.party_id)));
      setLogisticsErrors(Object.fromEntries(failures.map(failure => [failure.party_id, dbErrorMessage(failure, fr.saveError)])));

      if (!failures.length) {
        addToast(fr.logisticsAllSavedToast, 'success');
      } else {
        const names = failures.map(failure => parties.find(p => p.id === failure.party_id)?.profiles?.full_name || fr.defaultUserFallback);
        addToast(fr.logisticsSomeFailedToast.replace('{n}', failures.length).replace('{names}', names.join(', ')), 'error');
      }
    } catch (error) {
      console.error('Error saving logistics:', error);
      addToast(dbErrorMessage(error, fr.saveError), 'error');
    } finally {
      setSavingLogistics(false);
    }
  };

  // Data export (#178): both formats are built from the same rows (src/lib/dataExport.js).
  const exportOf = (exportId) => EXPORTS.find(item => item.id === exportId);

  const exportToCSV = (exportId) => {
    if (!activeParties.length) {
      addToast(fr.noDataToExport, 'warning');
      return;
    }
    const { build, filePrefix } = exportOf(exportId);
    const blob = new Blob([toCsv(build(activeParties))], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(filePrefix, activeEventState?.theme);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast(fr.exportCSVToast, 'success');
  };

  const copyToClipboardForSheets = (exportId) => {
    if (!activeParties.length) {
      addToast(fr.noDataToCopy, 'warning');
      return;
    }
    navigator.clipboard.writeText(toTsv(exportOf(exportId).build(activeParties))).then(() => {
      addToast(fr.exportCopyToast, 'success');
    }).catch(err => {
      console.error('Failed to copy:', err);
      addToast(fr.copyError, 'error');
    });
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6">
        <Notice tone="warn">{fr.adminAccessRestricted}</Notice>
      </main>
    );
  }

  const activeTabIndex = ADMIN_TABS.findIndex(tab => tab.id === activeTab);
  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const handleTabKeyDown = (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    let next = activeTabIndex + (keys[event.key] || 0);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = ADMIN_TABS.length - 1;
    next = (next + ADMIN_TABS.length) % ADMIN_TABS.length;
    selectTab(ADMIN_TABS[next].id);
    requestAnimationFrame(() => document.getElementById(`admin-tab-${ADMIN_TABS[next].id}`)?.focus());
  };

  const renderPanel = () => {
    if (loading) {
      return (
        <div aria-busy="true" className="space-y-4">
          <span className="sr-only">{fr.adminDashboardLoading}</span>
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      );
    }
    if (error) {
      return (
        <Notice
          tone="bad"
          title={fr.adminLoadError}
          action={<Button variant="secondary" size="sm" onClick={fetchAllData}><RotateCw aria-hidden="true" className="size-4" />{fr.retry}</Button>}
        >
          {error}
        </Notice>
      );
    }
    if (activeTab === 'events') {
      const backToEvents = () => selectTab('events');
      if (editEventId && !editingEvent) {
        return (
          <EmptyState icon={CalendarRange} title={fr.eventEditorNotFound}
            action={<Button variant="secondary" onClick={backToEvents}>{fr.eventEditorBack}</Button>} />
        );
      }
      if (editingEvent) {
        return (
          <EventEditor
            event={editingEvent}
            section={editSection}
            onSectionChange={section => go({ ...route, editorSection: section })}
            onVenueChange={refreshEvents}
            changes={eventChanges}
            dirtyCount={eventDirty.length}
            errors={eventErrors}
            restored={!!eventDraft?.restored && eventDirty.length > 0}
            saving={savingEvent}
            onChange={handleEventFieldChange}
            onSave={handleSaveEventChanges}
            onDiscard={discardEventChanges}
            onBack={backToEvents}
          />
        );
      }
      return (
        <AdminEventList
          events={events}
          draftEventId={hasUnsavedEvent ? eventDraft.eventId : null}
          onActivate={handleActivateEvent}
          onArchive={setPendingArchive}
          onEdit={(event) => go({ section: 'events', eventId: event.id, editorSection: 'details' })}
        />
      );
    }
    if (activeTab === 'venues') {
      return (
        <AdminVenues
          venueId={route.venueId}
          events={events}
          locationId={route.locationId}
          onOpen={venueId => go({ section: 'venues', venueId, locationId: null })}
          onLocationChange={locationId => go({ ...route, locationId })}
          onBack={() => selectTab('venues')}
          onVenueChange={refreshEvents}
          notify={addToast}
        />
      );
    }
    if (activeTab === 'tools') {
      const renderToolsView = () => {
        if (toolsView === 'history') {
          return events.length > 0
            ? <ChangeHistory events={events} notify={addToast} />
            : <EmptyState icon={History} title={fr.changeHistoryEmpty} />;
        }
        if (toolsView === 'feedback') {
          return (
            <FeedbackInbox
              items={feedbackItems}
              showResolved={showResolvedFeedback}
              onToggleResolved={setShowResolvedFeedback}
              onResolve={handleResolveFeedback}
            />
          );
        }
        return activeEventState
          ? <DataExport hasData={activeParties.length > 0} onExportCSV={exportToCSV} onCopyTSV={copyToClipboardForSheets} />
          : <EmptyState icon={CalendarRange} title={fr.noActiveEventTitle}>{fr.adminNoActiveEventHint}</EmptyState>;
      };
      return (
        <div className="space-y-6">
          <ViewTabs
            views={TOOLS_VIEWS.map(({ id, labelKey, icon }) => ({ id, label: fr[labelKey], icon }))}
            value={toolsView}
            onChange={view => go({ section: 'tools', view })}
            label={fr.toolsViewsLabel}
            idPrefix="tools-view"
          />
          <ViewPanel idPrefix="tools-view" value={toolsView}>{renderToolsView()}</ViewPanel>
        </div>
      );
    }
    if (!activeEventState) {
      return <EmptyState icon={CalendarRange} title={fr.noActiveEventTitle}>{fr.adminNoActiveEventHint}</EmptyState>;
    }
    if (activeTab === 'logistics') {
      return (
        <AdminLogisticsView
          view={logisticsView}
          venue={activeEventState?.venue}
          onViewChange={view => go({ section: 'logistics', view })}
          parties={activeParties}
          places={places}
          logisticsChanges={logisticsChanges}
          logisticsErrors={logisticsErrors}
          unsavedCount={unsavedLogistics}
          saving={savingLogistics}
          onPlaceChange={handlePlaceChange}
          onAdminNotesChange={handleAdminNotesChange}
          onSave={saveLogisticsChanges}
          onDiscard={discardLogisticsChanges}
          onOpenUserProfile={openUserProfile}
        />
      );
    }
    if (activeTab === 'budget') {
      return (
        <AdminBudget
          event={activeEventState}
          budget={budget}
          draft={budgetDraft}
          parties={activeParties}
          onDraftChange={draft => setBudgetDraft({ ...draft, eventId: activeEventState.id })}
          onSaveBudget={saveBudget}
          savingBudget={savingBudget}
          onApplyPricing={handleApplyPricing}
        />
      );
    }
    if (activeTab === 'users') {
      return (
        <AdminUserManagement
          parties={parties}
          currentUserId={currentUserId}
          onOpenUserProfile={openUserProfile}
          onAdminToggle={handleAdminToggle}
          onPaymentToggle={handlePaymentToggle}
          onEditParty={openPartyEdit}
        />
      );
    }
    return <AdminOverview event={activeEventState} budget={budget} parties={parties} places={places} onOpenParty={openPartyEdit} />;
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:px-6 md:pb-16">

      <div className="mb-6 flex flex-col gap-1">
        <p className="font-data text-xs uppercase tracking-widest text-neon">{activeEventState ? activeEventState.theme : fr.adminPageSubtitle}</p>
        <h1 className="font-display text-display-md text-ink">{fr.adminPageTitle}</h1>
      </div>

      {/* One tablist: inline pills from md up, a fixed bottom bar (thumb zone) on phones. */}
      <div
        role="tablist"
        aria-label={fr.adminTabsAriaLabel}
        onKeyDown={handleTabKeyDown}
        data-bottom-bar
        className={cx(
          'fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-line bg-night/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md',
          'md:static md:mb-8 md:flex md:gap-1 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none'
        )}
      >
        {ADMIN_TABS.map(tab => {
          const isActive = tab.id === activeTab;
          const Icon = tab.icon;
          const showDot = (tab.id === 'logistics' && unsavedLogistics > 0) || (tab.id === 'events' && hasUnsavedEvent);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`admin-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`admin-tabpanel-${tab.id}`}
              aria-label={fr[tab.labelKey]}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              className={cx(
                'relative flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-semibold transition duration-150',
                'md:min-h-11 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm',
                isActive ? 'text-neon md:tint-neon md:text-ink' : 'text-faint hover:text-ink md:hover:bg-raised'
              )}
            >
              <Icon aria-hidden="true" className={cx('size-5 md:size-4.5', isActive && 'md:text-neon')} strokeWidth={1.75} />
              <span className="md:hidden">{fr[tab.shortKey]}</span>
              <span className="hidden md:inline">{fr[tab.labelKey]}</span>
              {showDot && <span className="absolute right-[calc(50%-1.25rem)] top-2 size-2 rounded-full bg-warn md:static" aria-label={fr.unsavedTag} />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`admin-tabpanel-${activeTab}`} aria-labelledby={`admin-tab-${activeTab}`} key={activeTab} className="animate-step">
        {renderPanel()}
      </div>

      <UserProfileDialog profile={userProfileModal} history={userEventHistory} onClose={closeUserProfile} />

      <Dialog
        open={!!editingParty}
        onClose={closePartyEdit}
        dismissible={false}
        size="lg"
        title={fr.adminEditRegistrationTitle}
      >
        {editingParty && (
          <div className="px-4 pt-5 sm:px-6">
            <p className="mb-5 text-sm text-muted">{editingParty.profiles?.full_name} <span className="text-faint">{editingParty.profiles?.email}</span></p>
            <PartyEmailLog partyId={editingParty.id} />
            <RegistrationForm
              event={activeEventState}
              userRegistration={editingParty}
              adminMode={true}
              onAdminSave={handleAdminSave}
              onCancel={closePartyEdit}
            />
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!pendingPayment}
        tone="primary"
        title={pendingPayment?.newStatus === PAYMENT_STATUS.PAID ? fr.markPaid : fr.markUnpaid}
        confirmLabel={pendingPayment?.newStatus === PAYMENT_STATUS.PAID ? fr.markPaid : fr.markUnpaid}
        onConfirm={confirmPaymentToggle}
        onCancel={() => setPendingPayment(null)}
        loading={confirmBusy}
      >
        {pendingPayment && fr.paymentToggleConfirm
          .replace('{action}', getPaymentStatusShortLabel(pendingPayment.newStatus))
          .replace('{name}', pendingPayment.party.profiles?.full_name || fr.defaultUserFallback)}
      </ConfirmDialog>

      <ConfirmDialog
        open={leaveBlocker.state === 'blocked'}
        title={fr.logisticsLeaveTitle}
        confirmLabel={fr.logisticsLeaveConfirm}
        onConfirm={() => leaveBlocker.proceed()}
        onCancel={() => leaveBlocker.reset()}
      >
        {fr.logisticsLeaveBody.replace('{n}', unsavedLogistics)}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pendingArchive}
        title={fr.archiveEventConfirmTitle}
        confirmLabel={fr.archiveEventButton}
        onConfirm={confirmArchiveEvent}
        onCancel={() => setPendingArchive(null)}
        loading={confirmBusy}
      >
        {pendingArchive && fr.archiveEventConfirm.replace('{theme}', pendingArchive.theme)}
      </ConfirmDialog>
    </main>
  );
};

export default AdminView;
