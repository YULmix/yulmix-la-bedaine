import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Banknote, CalendarRange, ClipboardList, BedDouble, LayoutDashboard, RotateCw, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import RegistrationForm from '../components/RegistrationForm';
import AdminOverview from '../components/admin/AdminOverview';
import AdminLogisticsView from '../components/admin/AdminLogisticsView';
import AdminUserManagement from '../components/admin/AdminUserManagement';
import AdminBudget from '../components/admin/AdminBudget';
import { AdminEventList, EventEditDialog } from '../components/admin/AdminEvents';
import { DataExport, FeedbackInbox } from '../components/admin/AdminTools';
import UserProfileDialog from '../components/admin/UserProfileDialog';
import PartyEmailLog from '../components/admin/PartyEmailLog';
import { Button, ConfirmDialog, Dialog, EmptyState, Notice, Skeleton, cx } from '../components/ui';
import {
  ACCOMMODATION_OPTIONS,
  getOptionLabel,
  PAYMENT_STATUS,
  REGISTRATION_STATUS,
  getPaymentStatusShortLabel,
  isActiveRegistration
} from '../lib/registrationOptions';
import { priceRatiosOf, simulateEventPricing } from '../lib/pricingEngine';
import { useToasts } from '../hooks/useToasts';
import ToastContainer from '../components/Toast';

// Admin sub-navigation tabs; the id is what appears in the URL (?tab=<id>). `users` and
// `logistics` keep their original ids so existing deep links still work.
const ADMIN_TABS = [
  { id: 'overview', labelKey: 'adminTabOverview', shortKey: 'adminTabOverviewShort', icon: LayoutDashboard },
  { id: 'users', labelKey: 'adminTabUsers', shortKey: 'adminTabUsersShort', icon: ClipboardList },
  { id: 'logistics', labelKey: 'adminTabLogistics', shortKey: 'adminTabLogisticsShort', icon: BedDouble },
  { id: 'budget', labelKey: 'adminTabBudget', shortKey: 'adminTabBudgetShort', icon: Banknote },
  { id: 'events', labelKey: 'adminTabEvents', shortKey: 'adminTabEventsShort', icon: CalendarRange },
  { id: 'tools', labelKey: 'adminTabTools', shortKey: 'adminTabToolsShort', icon: Wrench }
];
const DEFAULT_ADMIN_TAB = ADMIN_TABS[0].id;

const AdminView = ({ activeEvent, otherEvents, isAdmin, onSignOut }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = ADMIN_TABS.some(tab => tab.id === requestedTab) ? requestedTab : DEFAULT_ADMIN_TAB;
  const selectTab = (tabId) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tabId);
      return next;
    });
  };
  const [events, setEvents] = useState([]);
  const [parties, setParties] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeEventState, setActiveEventState] = useState(activeEvent || null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editingParty, setEditingParty] = useState(null);
  const [eventChanges, setEventChanges] = useState({});
  const { toasts, addToast, removeToast } = useToasts(1699);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [realtimeChannel, setRealtimeChannel] = useState(null);
  const [userProfileModal, setUserProfileModal] = useState(null);
  const [userEventHistory, setUserEventHistory] = useState([]);
  const [logisticsChanges, setLogisticsChanges] = useState({});
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

  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all events
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false });
      if (eventsError) throw eventsError;
      setEvents(eventsData || []);

      const activeEv = eventsData?.find(e => e.is_active) || eventsData?.[0];
      setActiveEventState(activeEv);
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
      setError(err.message);
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
      addToast(err.message || fr.error, 'error');
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

  // New base price and main-event ratio. The database reprices every unpaid registration (#32, #109).
  const applyPricing = async (pricing) => {
    try {
      const { error: updateError } = await supabase
        .from('events')
        .update(pricing)
        .eq('id', activeEventState.id);
      if (updateError) throw updateError;
      const { count, error: countError } = await supabase
        .from('user_parties')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', activeEventState.id)
        .eq('payment_status', PAYMENT_STATUS.UNPAID)
        .neq('status', REGISTRATION_STATUS.CANCELLED);
      addToast(
        countError ? fr.eventMetadataUpdatedToast
          : count > 0 ? fr.eventRepricedCountToast.replace('{count}', count) : fr.eventRepricedNoneToast,
        'success'
      );
      await fetchAllData();
    } catch (err) {
      console.error('Error applying pricing:', err);
      addToast(fr.updateError, 'error');
    }
  };

  const fetchParties = async (eventId) => {
    try {
      const { data: partiesData, error } = await supabase
        .from('user_parties')
        .select(`
          *,
          profiles!inner(id, email, full_name, is_admin, created_at, deleted_at)
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // A deleted account's registrations for events to come were cancelled with it (#36): it's no
      // longer a member of this edition. Its other registrations stay, as history.
      setParties((partiesData || []).filter(party =>
        !(party.profiles?.deleted_at && party.status === REGISTRATION_STATUS.CANCELLED)
      ));
    } catch (err) {
      console.error('Error fetching parties:', err);
      setError(err.message);
    }
  };

  // Activation Mutex: validate UI state before DB update
  const handleActivateEvent = async (event) => {
    const alreadyActive = events.find(e => e.is_active);
    if (alreadyActive && alreadyActive.id !== event.id) {
      addToast(fr.eventAlreadyActiveError, 'error');
      return;
    }
    try {
      const { error } = await supabase
        .from('events')
        .update({ is_active: true, status: 'ACTIVE' })
        .eq('id', event.id);
      if (error) {
        if (error.code === '23505') {
          addToast(fr.eventAlreadyActiveError, 'error');
        } else {
          throw error;
        }
      } else {
        addToast(fr.eventActivatedToast.replace('{theme}', event.theme), 'success');
        fetchAllData();
      }
    } catch (err) {
      console.error('Error activating event:', err);
      addToast(err.message || fr.eventActivationError, 'error');
    }
  };

  const confirmArchiveEvent = async () => {
    const event = pendingArchive;
    if (!event) return;
    setConfirmBusy(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({ is_active: false, status: 'ARCHIVED' })
        .eq('id', event.id);
      if (error) throw error;
      addToast(fr.eventArchivedToast.replace('{theme}', event.theme), 'success');
      fetchAllData();
    } catch (err) {
      console.error('Error archiving event:', err);
      addToast(err.message || fr.eventArchivingError, 'error');
    } finally {
      setConfirmBusy(false);
      setPendingArchive(null);
    }
  };

  // Inline editing for event metadata
  const handleEventFieldChange = (field, value) => {
    setEventChanges(prev => ({ ...prev, [field]: value }));
  };
  // Helper for updating external links array
  const handleExternalLinksChange = (index, field, value) => {
    const current = eventChanges.external_links ?? editingEvent?.external_links ?? [];
    // Copy the row: editing it in place would change the loaded event too.
    const updated = current.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    handleEventFieldChange('external_links', updated);
  };

  const addExternalLinksRow = () => {
    const current = eventChanges.external_links ?? editingEvent?.external_links ?? [];
    handleEventFieldChange('external_links', [...current, { label: '', url: '' }]);
  };

  const removeExternalLinksRow = (index) => {
    const current = eventChanges.external_links ?? editingEvent?.external_links ?? [];
    const updated = current.filter((_, i) => i !== index);
    handleEventFieldChange('external_links', updated);
  };

  const saveEventChanges = async () => {
    if (!editingEvent) return;
    
    // If no changes were made, just close the modal with info message
    if (Object.keys(eventChanges).length === 0) {
      addToast(fr.noChangesMade, 'info');
      setEditingEvent(null);
      return;
    }
    
    try {
      const { error } = await supabase
        .from('events')
        .update(eventChanges)
        .eq('id', editingEvent.id);
      if (error) throw error;
      addToast(fr.eventMetadataUpdatedToast, 'success');
      setEventChanges({});
      setEditingEvent(null);
      fetchAllData();
    } catch (err) {
      console.error('Error updating event:', err);
      addToast(err.message || fr.updateError, 'error');
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
        addToast(err.message || fr.updateError, 'error');
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
      const { error } = await supabase
        .from('user_parties')
        .update({ payment_status: newStatus })
        .eq('id', party.id);
      if (error) throw error;
      addToast(fr.paymentStatusUpdatedToast.replace('{action}', action), 'success');
      fetchParties(activeEventState.id);
    } catch (err) {
      console.error('Error updating payment status:', err);
      addToast(err.message || fr.updateError, 'error');
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


  // Calculate rounded party total using current pricing with rounding up
  const calculateRoundedPartyTotal = (party) => {
    if (!activeEventState?.selling_price_whole_event) return party.calculated_amount_owed || 0;
    
    // Prepare party in format expected by simulateEventPricing.
    // Preserve grandfathering: a party that already paid keeps its historical amount
    // rather than being repriced at the current selling price.
    const partyForSimulation = {
      id: party.id,
      attendees: party.attendees || [],
      is_paid: party.payment_status === PAYMENT_STATUS.PAID,
      historical_owed: party.calculated_amount_owed || 0
    };
    
    try {
      // Simulate pricing for this single party
      const simulation = simulateEventPricing(
        [partyForSimulation],
        Number(activeEventState.selling_price_whole_event),
        priceRatiosOf(activeEventState)
      );
      
      // Return the calculated amount (already rounded up by pricing engine)
      return simulation.calculated_amount_owed;
    } catch (error) {
      console.error('Error calculating rounded party total:', error);
      return party.calculated_amount_owed || 0;
    }
  };

  // Cancelled parties owe nothing and count for nothing (no refunds, #101). Only the users tab
  // (its "Annulées" filter) and the god-mode edit still see them; everything else uses this.
  const activeParties = useMemo(() => parties.filter(isActiveRegistration), [parties]);

  // Memoize per-party rounded totals so the pricing engine only reruns when the
  // parties list or selling price actually changes, not on every render.
  const roundedPartyTotals = useMemo(() => {
    const totals = new Map();
    parties.forEach(party => {
      totals.set(party.id, calculateRoundedPartyTotal(party));
    });
    return totals;
  }, [parties, activeEventState?.selling_price_whole_event, activeEventState?.ratio_main_whole]);

  const getRoundedPartyTotal = useCallback(
    (party) => roundedPartyTotals.get(party.id) ?? (party.calculated_amount_owed || 0),
    [roundedPartyTotals]
  );

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

  // Logistics updates
  const handleAdminNotesChange = (partyId, value) => {
    setLogisticsChanges(prev => ({
      ...prev,
      [partyId]: {
        ...prev[partyId],
        adminNotes: value
      }
    }));
  };

  const handleAssignedBedChange = (partyId, attendeeIndex, value) => {
    setLogisticsChanges(prev => ({
      ...prev,
      [partyId]: {
        ...prev[partyId],
        attendees: {
          ...prev[partyId]?.attendees,
          [attendeeIndex]: value
        }
      }
    }));
  };

  const saveLogisticsChanges = async (partyId) => {
    const changes = logisticsChanges[partyId];
    if (!changes) return;

    const party = parties.find(p => p.id === partyId);
    if (!party) return;

    try {
      const updatedAttendees = (party.attendees || []).map((attendee, index) => (
        changes.attendees && changes.attendees[index] !== undefined
          ? { ...attendee, assigned_bed: changes.attendees[index] }
          : attendee
      ));

      const updateData = {
        attendees: updatedAttendees,
        admin_notes: changes.adminNotes !== undefined ? changes.adminNotes : party.admin_notes
      };

      const { error } = await supabase
        .from('user_parties')
        .update(updateData)
        .eq('id', partyId);

      if (error) throw error;

      addToast(fr.logisticsUpdatedToast, 'success');

      // Clear changes and refresh
      setLogisticsChanges(prev => {
        const newChanges = { ...prev };
        delete newChanges[partyId];
        return newChanges;
      });

      fetchParties(activeEventState.id);
    } catch (error) {
      console.error('Error saving logistics:', error);
      addToast(fr.saveError, 'error');
    }
  };

  // Summarize per-attendee accommodation info for the party-level export rows
  const summarizeAccommodationPrefs = (party) => (party.attendees || [])
    .map(a => getOptionLabel(ACCOMMODATION_OPTIONS, a.sleeping_preference, ''))
    .filter(Boolean)
    .join('; ');

  const summarizeAssignedBeds = (party) => (party.attendees || [])
    .filter(a => a.assigned_bed)
    .map(a => `${a.name || '?'}: ${a.assigned_bed}`)
    .join('; ');

  // Data export functions
  const exportToCSV = () => {
    if (!activeParties.length) {
      addToast(fr.noDataToExport, 'warning');
      return;
    }
    
    const headers = [
      fr.exportPartyName,
      fr.exportEmail,
      fr.exportAdultWhole,
      fr.exportAdultMain,
      fr.exportTeenWhole,
      fr.exportTeenMain,
      fr.exportKids,
      fr.exportSleepingPref,
      fr.exportSleepingAssigned,
      fr.exportPaymentStatus,
      fr.exportAmountOwed
    ];
    
    const rows = activeParties.map(party => {
      const profile = party.profiles || {};
      const counts = party.counts || {};

      return [
        `"${profile.full_name || ''}"`,
        `"${profile.email || ''}"`,
        counts.adult_whole || 0,
        counts.adult_main || 0,
        counts.teen_whole || 0,
        counts.teen_main || 0,
        counts.kids || 0,
        `"${summarizeAccommodationPrefs(party)}"`,
        `"${summarizeAssignedBeds(party)}"`,
        getPaymentStatusShortLabel(party.payment_status),
        party.calculated_amount_owed || 0
      ];
    });
    
    // Add totals row
    const totals = activeParties.reduce((acc, party) => {
      const counts = party.counts || {};
      return {
        adultWhole: acc.adultWhole + (counts.adult_whole || 0),
        adultMain: acc.adultMain + (counts.adult_main || 0),
        teenWhole: acc.teenWhole + (counts.teen_whole || 0),
        teenMain: acc.teenMain + (counts.teen_main || 0),
        kids: acc.kids + (counts.kids || 0),
        amountOwed: acc.amountOwed + (party.calculated_amount_owed || 0)
      };
    }, { adultWhole: 0, adultMain: 0, teenWhole: 0, teenMain: 0, kids: 0, amountOwed: 0 });
    
    rows.push([
      fr.exportTotals,
      '',
      totals.adultWhole,
      totals.adultMain,
      totals.teenWhole,
      totals.teenMain,
      totals.kids,
      '',
      '',
      '',
      totals.amountOwed
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    
    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inscriptions_${activeEventState?.theme || 'event'}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    addToast(fr.exportCSVToast, 'success');
  };

  const copyToClipboardForSheets = () => {
    if (!activeParties.length) {
      addToast(fr.noDataToCopy, 'warning');
      return;
    }
    
    const headers = [
      fr.exportPartyName,
      fr.exportEmail,
      fr.exportAdultWhole,
      fr.exportAdultMain,
      fr.exportTeenWhole,
      fr.exportTeenMain,
      fr.exportKids,
      fr.exportSleepingPref,
      fr.exportSleepingAssigned,
      fr.exportPaymentStatus,
      fr.exportAmountOwed
    ];
    
    const rows = activeParties.map(party => {
      const profile = party.profiles || {};
      const counts = party.counts || {};

      return [
        profile.full_name || '',
        profile.email || '',
        counts.adult_whole || 0,
        counts.adult_main || 0,
        counts.teen_whole || 0,
        counts.teen_main || 0,
        counts.kids || 0,
        summarizeAccommodationPrefs(party),
        summarizeAssignedBeds(party),
        getPaymentStatusShortLabel(party.payment_status),
        party.calculated_amount_owed || 0
      ];
    });
    
    // Add totals row
    const totals = activeParties.reduce((acc, party) => {
      const counts = party.counts || {};
      return {
        adultWhole: acc.adultWhole + (counts.adult_whole || 0),
        adultMain: acc.adultMain + (counts.adult_main || 0),
        teenWhole: acc.teenWhole + (counts.teen_whole || 0),
        teenMain: acc.teenMain + (counts.teen_main || 0),
        kids: acc.kids + (counts.kids || 0),
        amountOwed: acc.amountOwed + (party.calculated_amount_owed || 0)
      };
    }, { adultWhole: 0, adultMain: 0, teenWhole: 0, teenMain: 0, kids: 0, amountOwed: 0 });
    
    rows.push([
      fr.exportTotals,
      '',
      totals.adultWhole,
      totals.adultMain,
      totals.teenWhole,
      totals.teenMain,
      totals.kids,
      '',
      '',
      '',
      totals.amountOwed
    ]);
    
    const tsvContent = [headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n');
    
    navigator.clipboard.writeText(tsvContent).then(() => {
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
      return (
        <AdminEventList
          events={events}
          onActivate={handleActivateEvent}
          onArchive={setPendingArchive}
          onEdit={(event) => { setEditingEvent(event); setEventChanges({}); }}
        />
      );
    }
    if (activeTab === 'tools') {
      return (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            {activeEventState && <DataExport hasData={activeParties.length > 0} onExportCSV={exportToCSV} onCopyTSV={copyToClipboardForSheets} />}
          </div>
          <FeedbackInbox
            items={feedbackItems}
            showResolved={showResolvedFeedback}
            onToggleResolved={setShowResolvedFeedback}
            onResolve={handleResolveFeedback}
          />
        </div>
      );
    }
    if (!activeEventState) {
      return <EmptyState icon={CalendarRange} title={fr.noActiveEventTitle}>{fr.adminNoActiveEventHint}</EmptyState>;
    }
    if (activeTab === 'logistics') {
      return (
        <AdminLogisticsView
          parties={activeParties}
          logisticsChanges={logisticsChanges}
          onAssignedBedChange={handleAssignedBedChange}
          onAdminNotesChange={handleAdminNotesChange}
          onSave={saveLogisticsChanges}
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
          onApplyPricing={applyPricing}
        />
      );
    }
    if (activeTab === 'users') {
      return (
        <AdminUserManagement
          parties={parties}
          currentUserId={currentUserId}
          getRoundedPartyTotal={getRoundedPartyTotal}
          onOpenUserProfile={openUserProfile}
          onAdminToggle={handleAdminToggle}
          onPaymentToggle={handlePaymentToggle}
          onEditParty={openPartyEdit}
        />
      );
    }
    return <AdminOverview event={activeEventState} budget={budget} parties={parties} getRoundedPartyTotal={getRoundedPartyTotal} onOpenParty={openPartyEdit} />;
  };

  const unsavedLogistics = Object.keys(logisticsChanges).length;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:px-6 md:pb-16">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      <div className="mb-6 flex flex-col gap-1">
        <p className="font-data text-xs uppercase tracking-widest text-neon">{activeEventState ? activeEventState.theme : fr.adminPageSubtitle}</p>
        <h1 className="font-display text-display-md text-ink">{fr.adminPageTitle}</h1>
      </div>

      {/* One tablist: inline pills from md up, a fixed bottom bar (thumb zone) on phones. */}
      <div
        role="tablist"
        aria-label={fr.adminTabsAriaLabel}
        onKeyDown={handleTabKeyDown}
        className={cx(
          'fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-night/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md',
          'md:static md:mb-8 md:flex md:gap-1 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none'
        )}
      >
        {ADMIN_TABS.map(tab => {
          const isActive = tab.id === activeTab;
          const Icon = tab.icon;
          const showDot = tab.id === 'logistics' && unsavedLogistics > 0;
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

      <EventEditDialog
        event={editingEvent}
        changes={eventChanges}
        onChange={handleEventFieldChange}
        onLinkChange={handleExternalLinksChange}
        onAddLinkRow={addExternalLinksRow}
        onRemoveLinkRow={removeExternalLinksRow}
        onSave={saveEventChanges}
        onClose={() => setEditingEvent(null)}
      />

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
