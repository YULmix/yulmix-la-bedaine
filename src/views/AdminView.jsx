import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import RegistrationForm from '../components/RegistrationForm';
import {
  ACCOMMODATION_OPTIONS,
  BED_REASON_OPTIONS,
  DIETARY_OPTIONS,
  TIER_OPTIONS,
  getOptionLabel,
  getDietaryRequestsLabel,
  PAYMENT_STATUS,
  getPaymentStatusShortLabel
} from '../lib/registrationOptions';
import { simulateEventPricing, calculateEstimatedCostPerParticipant, calculateBasePoints, calculatePricePerPointFromSellingPrice, getFinalPoints } from '../lib/pricingEngine';

const AdminView = ({ activeEvent, otherEvents, isAdmin, onSignOut }) => {
  const [events, setEvents] = useState([]);
  const [parties, setParties] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeEventState, setActiveEventState] = useState(activeEvent || null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editingParty, setEditingParty] = useState(null);
  const [eventChanges, setEventChanges] = useState({});
  const [toasts, setToasts] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [realtimeChannel, setRealtimeChannel] = useState(null);
  const [userProfileModal, setUserProfileModal] = useState(null);
  const [userEventHistory, setUserEventHistory] = useState([]);
  const [logisticsChanges, setLogisticsChanges] = useState({});
  const [scenarioValues, setScenarioValues] = useState({
    adultWhole: 0,
    adultMain: 0,
    teenWhole: 0,
    teenMain: 0,
    kids: 0,
    sellingPriceOverride: '',
    pricePerPointOverride: ''
  });
  const [simulationResult, setSimulationResult] = useState(null);
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [showResolvedFeedback, setShowResolvedFeedback] = useState(false);

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
        await fetchParties(activeEv.id);
      }

      // Fetch all profiles for admin checkbox
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name, is_admin')
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

  const fetchParties = async (eventId) => {
    try {
      const { data: partiesData, error } = await supabase
        .from('user_parties')
        .select(`
          *,
          profiles!inner(email, full_name, is_admin)
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setParties(partiesData || []);
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

  const handleArchiveEvent = async (event) => {
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
    }
  };

  // Inline editing for event metadata
  const handleEventFieldChange = (field, value) => {
    setEventChanges(prev => ({ ...prev, [field]: value }));
  };
  // Helper for updating cost breakdown array
  const handleCostBreakdownChange = (index, field, value) => {
    const current = eventChanges.cost_breakdown ?? editingEvent?.cost_breakdown ?? [];
    const updated = [...current];
    if (!updated[index]) updated[index] = {};
    updated[index][field] = value;
    handleEventFieldChange('cost_breakdown', updated);
  };

  const addCostBreakdownRow = () => {
    const current = eventChanges.cost_breakdown ?? editingEvent?.cost_breakdown ?? [];
    handleEventFieldChange('cost_breakdown', [...current, { category: '', amount: 0 }]);
  };

  const removeCostBreakdownRow = (index) => {
    const current = eventChanges.cost_breakdown ?? editingEvent?.cost_breakdown ?? [];
    const updated = current.filter((_, i) => i !== index);
    handleEventFieldChange('cost_breakdown', updated);
  };

  // Helper for updating external links array
  const handleExternalLinksChange = (index, field, value) => {
    const current = eventChanges.external_links ?? editingEvent?.external_links ?? [];
    const updated = [...current];
    if (!updated[index]) updated[index] = {};
    updated[index][field] = value;
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
      const isPriceChange = 'selling_price_whole_event' in eventChanges
        && eventChanges.selling_price_whole_event !== editingEvent.selling_price_whole_event;

      const { error } = await supabase
        .from('events')
        .update(eventChanges)
        .eq('id', editingEvent.id);
      if (error) throw error;

      if (isPriceChange) {
        const { count, error: countError } = await supabase
          .from('user_parties')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', editingEvent.id)
          .eq('payment_status', PAYMENT_STATUS.UNPAID);
        if (!countError) {
          addToast(
            count > 0
              ? fr.eventRepricedCountToast.replace('{count}', count)
              : fr.eventRepricedNoneToast,
            'success'
          );
        } else {
          addToast(fr.eventMetadataUpdatedToast, 'success');
        }
      } else {
        addToast(fr.eventMetadataUpdatedToast, 'success');
      }
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

  // Payment status toggle
  const handlePaymentToggle = async (party, newStatus) => {
    const action = getPaymentStatusShortLabel(newStatus);
    const confirmMessage = fr.paymentToggleConfirm
      .replace('{action}', action)
      .replace('{name}', party.profiles?.full_name || fr.defaultUserFallback);

    if (!window.confirm(confirmMessage)) return;

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

  // Aggregate totals calculations
  const aggregateTotals = useCallback(() => {
    if (!parties.length) return { adults: 0, teens: 0, kids: 0, sleeping: {}, dietary: {} };
    const totals = {
      adult_whole: 0,
      adult_main: 0,
      teen_whole: 0,
      teen_main: 0,
      kids: 0,
    };
    return totals;
  }, [parties]);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 1699);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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
        activeEventState.selling_price_whole_event
      );
      
      // Return the calculated amount (already rounded up by pricing engine)
      return simulation.calculated_amount_owed;
    } catch (error) {
      console.error('Error calculating rounded party total:', error);
      return party.calculated_amount_owed || 0;
    }
  };

  // Memoize per-party rounded totals so the pricing engine only reruns when the
  // parties list or selling price actually changes, not on every render.
  const roundedPartyTotals = useMemo(() => {
    const totals = new Map();
    parties.forEach(party => {
      totals.set(party.id, calculateRoundedPartyTotal(party));
    });
    return totals;
  }, [parties, activeEventState?.selling_price_whole_event]);

  const getRoundedPartyTotal = (party) => roundedPartyTotals.get(party.id) ?? (party.calculated_amount_owed || 0);

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

  // Scenario simulator
  const handleScenarioChange = (field, value) => {
    setScenarioValues(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const runSimulation = () => {
    // Build a single synthetic party holding every simulated attendee, so the pricing
    // engine's per-party rounding is applied once to the total rather than once per
    // attendee (which would inflate the projected total).
    const attendees = [];

    const addAttendees = (type, participation, count) => {
      for (let i = 0; i < count; i++) {
        attendees.push({
          id: `attendee-${attendees.length}`,
          type: type === 'adult' ? 'Adult' : type === 'teen' ? 'Teenager' : 'Kid',
          participation: participation === 'Whole' ? 'Whole' : 'Main',
          isNewMember: false
        });
      }
    };

    addAttendees('adult', 'Whole', scenarioValues.adultWhole);
    addAttendees('adult', 'Main', scenarioValues.adultMain);
    addAttendees('teen', 'Whole', scenarioValues.teenWhole);
    addAttendees('teen', 'Main', scenarioValues.teenMain);

    // Kids don't count for points but we include them
    for (let i = 0; i < scenarioValues.kids; i++) {
      attendees.push({
        id: `attendee-kid-${i}`,
        type: 'Kid',
        participation: 'After-Party',
        isNewMember: false
      });
    }

    const syntheticParties = [{ id: 'sim-party', attendees }];

    const sellingPrice = scenarioValues.sellingPriceOverride
      ? parseFloat(scenarioValues.sellingPriceOverride) 
      : activeEventState?.selling_price_whole_event || 0;
    
    const priceOverride = scenarioValues.pricePerPointOverride 
      ? parseFloat(scenarioValues.pricePerPointOverride) 
      : null;
    
    const result = simulateEventPricing(syntheticParties, sellingPrice, priceOverride);
    setSimulationResult(result);
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
    if (!parties.length) {
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
    
    const rows = parties.map(party => {
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
    const totals = parties.reduce((acc, party) => {
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
    if (!parties.length) {
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
    
    const rows = parties.map(party => {
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
    const totals = parties.reduce((acc, party) => {
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
      <div className="container mx-auto px-4 py-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          <p>{fr.adminAccessRestricted}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-600">{fr.adminDashboardLoading}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">{fr.adminPageTitle}</h1>
        <p className="text-gray-600">{fr.adminPageSubtitle}</p>
      </div>

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`px-4 py-3 rounded-lg shadow-lg ${
            toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' :
            toast.type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' :
            'bg-blue-100 text-blue-800 border border-blue-200'
          }`}>
            {toast.message}
          </div>
        ))}
      </div>

      {/* Event Management */}
      <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">{fr.adminEventsManagementTitle}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map(event => (
            <div key={event.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-medium text-gray-800">{event.theme}</h3>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  event.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                  event.status === 'ARCHIVED' ? 'bg-gray-100 text-gray-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {event.status === 'ACTIVE' ? fr.eventStatusActive : event.status === 'ARCHIVED' ? fr.eventStatusArchived : fr.draft}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-3">{event.description?.substring(0, 100)}...</p>
              <div className="flex space-x-2">
                {!event.is_active && event.status !== 'ARCHIVED' && (
                  <button
                    onClick={() => handleActivateEvent(event)}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    {fr.activateEventButton}
                  </button>
                )}
                {event.is_active && (
                  <button
                    onClick={() => handleArchiveEvent(event)}
                    className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                  >
                    {fr.archiveEventButton}
                  </button>
                )}
                {event.is_active && (
                  <button
                    onClick={() => {
                      setEditingEvent(event);
                      setEventChanges({});
                    }}
                    className="px-3 py-1 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
                  >
                    {fr.edit}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Inline event metadata editing modal */}
      {editingEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">{fr.editEventMetadataTitle}</h2>
              <button onClick={() => setEditingEvent(null)} className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100">
                ✕
              </button>
            </div>
<div className="p-6 space-y-4">
              {/* 1. Thème */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventTitle}</label>
                <input type="text" value={eventChanges.theme ?? editingEvent.theme} onChange={e => handleEventFieldChange('theme', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 2. Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventDescriptionLabel}</label>
                <textarea value={eventChanges.description ?? editingEvent.description} onChange={e => handleEventFieldChange('description', e.target.value)} rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 3. Adresse du lieu */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventVenueAddressLabel}</label>
                <input type="text" value={eventChanges.venue_address ?? editingEvent.venue_address} onChange={e => handleEventFieldChange('venue_address', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 4. Durée (jours) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventDurationLabel}</label>
                <input type="number" value={eventChanges.duration_days ?? editingEvent.duration_days} onChange={e => handleEventFieldChange('duration_days', parseInt(e.target.value) || 2)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 5. Date de début des inscriptions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventRegStartDateLabel}</label>
                <input type="date" value={eventChanges.reg_start_date ?? editingEvent.reg_start_date} onChange={e => handleEventFieldChange('reg_start_date', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 5b. Date de début de l'événement */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventStartDateLabel}</label>
                <input type="date" value={eventChanges.event_start_date ?? editingEvent.event_start_date ?? ''} onChange={e => handleEventFieldChange('event_start_date', e.target.value || null)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 6. Délai d'intention avant inscription (mois) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventIntentMonthsLabel}</label>
                <input type="number" value={eventChanges.z_intent_months ?? editingEvent.z_intent_months} onChange={e => handleEventFieldChange('z_intent_months', parseInt(e.target.value) || 2)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 7. Fermeture des inscriptions avant l'événement (semaines) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventRegCloseWeeksLabel}</label>
                <input type="number" value={eventChanges.x_reg_close_weeks ?? editingEvent.x_reg_close_weeks} onChange={e => handleEventFieldChange('x_reg_close_weeks', parseInt(e.target.value) || 1)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 8. Inscriptions ouvertes */}
              <div>
                <div className="flex items-center">
                  <input type="checkbox" id="is_reg_open" checked={eventChanges.is_reg_open ?? editingEvent.is_reg_open ?? false} onChange={e => handleEventFieldChange('is_reg_open', e.target.checked)} className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                  <label htmlFor="is_reg_open" className="ml-2 block text-sm font-medium text-gray-700">{fr.eventRegOpenLabel}</label>
                </div>
              </div>

              {/* 9. Points de contact */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventPointsOfContactLabel}</label>
                <textarea value={eventChanges.points_of_contact ?? editingEvent.points_of_contact} onChange={e => handleEventFieldChange('points_of_contact', e.target.value)} rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
{/* 10. Nombre maximum de participants */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventMaxAttendeesLabel}</label>
                <input type="number" value={eventChanges.max_attendees ?? editingEvent.max_attendees} onChange={e => handleEventFieldChange('max_attendees', parseInt(e.target.value) || 90)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 11. Coût total (CAD) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventTotalCostLabel}</label>
                <input type="number" step="0.01" value={eventChanges.total_cost ?? editingEvent.total_cost} onChange={e => handleEventFieldChange('total_cost', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 12. Catégorie de dépense */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventExpenseCategoryLabel}</label>
                <select value={eventChanges.expense_category ?? editingEvent.expense_category ?? ''} onChange={e => handleEventFieldChange('expense_category', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  <option value="">{fr.selectPlaceholder}</option>
                  <option value="Chalet">{fr.eventExpenseCategoryChalet}</option>
                  <option value="Food">{fr.eventExpenseCategoryFood}</option>
                  <option value="Music">{fr.eventExpenseCategoryMusic}</option>
                  <option value="Tech">{fr.eventExpenseCategoryTech}</option>
                  <option value="Accessories">{fr.eventExpenseCategoryAccessories}</option>
                </select>
              </div>

              {/* 13. Répartition des coûts */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventCostBreakdownLabel}</label>
                {(eventChanges.cost_breakdown ?? editingEvent?.cost_breakdown ?? []).map((row, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <input type="text" placeholder={fr.eventCostBreakdownCategoryPlaceholder} value={row.category || ''} onChange={e => handleCostBreakdownChange(index, 'category', e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    <input type="number" step="0.01" placeholder={fr.eventCostBreakdownAmountPlaceholder} value={row.amount || ''} onChange={e => handleCostBreakdownChange(index, 'amount', parseFloat(e.target.value) || 0)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    <button type="button" onClick={() => removeCostBreakdownRow(index)} className="px-3 py-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg">
                      {fr.eventCostBreakdownRemoveRow}
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addCostBreakdownRow} className="mt-2 px-4 py-2 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg">
                  {fr.eventCostBreakdownAddRow}
                </button>
              </div>
            
{/* 14. Prix de vente (weekend complet) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventSellingPriceLabel}</label>
                <input type="number" step="0.01" value={eventChanges.selling_price_whole_event ?? editingEvent.selling_price_whole_event} onChange={e => handleEventFieldChange('selling_price_whole_event', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 15. Coût de revient estimé (weekend complet) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventEstimatedCostLabel}</label>
                <input type="number" step="0.01" value={eventChanges.estimated_individual_cost_whole_event ?? editingEvent.estimated_individual_cost_whole_event} onChange={e => handleEventFieldChange('estimated_individual_cost_whole_event', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              {/* 16. Liens externes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventExternalLinksLabel}</label>
                {(eventChanges.external_links ?? editingEvent?.external_links ?? []).map((row, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <input type="text" placeholder={fr.eventExternalLinksLabelPlaceholder} value={row.label || ''} onChange={e => handleExternalLinksChange(index, 'label', e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    <input type="url" placeholder={fr.eventExternalLinksUrlPlaceholder} value={row.url || ''} onChange={e => handleExternalLinksChange(index, 'url', e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                    <button type="button" onClick={() => removeExternalLinksRow(index)} className="px-3 py-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg">
                      {fr.eventExternalLinksRemoveRow}
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addExternalLinksRow} className="mt-2 px-4 py-2 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg">
                  {fr.eventExternalLinksAddRow}
                </button>
              </div>

              {/* 17. Instructions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.eventInstructionsLabel}</label>
                <textarea value={eventChanges.instructions ?? editingEvent.instructions} onChange={e => handleEventFieldChange('instructions', e.target.value)} rows="4" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end space-x-3">
              <button onClick={() => setEditingEvent(null)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">{fr.cancel}</button>
              <button onClick={saveEventChanges} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{fr.save}</button>
            </div>
          </div>
        </div>
      )}
      {/* Real-time Aggregate Dashboard */}
      {activeEventState && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-800">{fr.dashboard}</h2>
            <div className="text-sm text-gray-500">{fr.activeEventLabel} <strong>{activeEventState.theme}</strong></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-blue-700">{parties.reduce((sum, p) => sum + (p.counts?.adult_whole || 0) + (p.counts?.adult_main || 0), 0)}</div>
              <div className="text-sm text-blue-600 mt-1">{fr.adultsStatLabel}</div>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-green-700">{parties.reduce((sum, p) => sum + (p.counts?.teen_whole || 0) + (p.counts?.teen_main || 0), 0)}</div>
              <div className="text-sm text-green-600 mt-1">{fr.teenagersStatLabel}</div>
            </div>
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-purple-700">{parties.reduce((sum, p) => sum + (p.counts?.kids || 0), 0)}</div>
              <div className="text-sm text-purple-600 mt-1">{fr.kidsStatLabel}</div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-amber-700">{parties.length}</div>
              <div className="text-sm text-amber-600 mt-1">{fr.registeredGroupsStatLabel}</div>
            </div>
</div>
           {/* Cost vs Price Display */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 mt-8">
             <div className="bg-blue-50 border border-blue-100 rounded-lg p-6">
               <h3 className="text-lg font-medium text-gray-700 mb-3">{fr.costVsPriceTitle}</h3>
               <div className="space-y-4">
                 <div className="flex justify-between items-center">
                   <span className="text-sm text-gray-600">{fr.estimatedCostPerParticipant}</span>
                   <span className="text-xl font-bold text-blue-700">
                     {activeEventState?.estimated_individual_cost_whole_event 
                       ? formatCurrency(activeEventState.estimated_individual_cost_whole_event)
                       : fr.notSpecified}
                   </span>
                 </div>
                 {activeEventState?.selling_price_whole_event ? (() => {
                   const pricePerPoint = calculatePricePerPointFromSellingPrice(activeEventState.selling_price_whole_event);
                   const newbiePoints = getFinalPoints({ type: 'Adult', participation: 'Main', isNewMember: true });
                   const kidOption = TIER_OPTIONS.find(opt => opt.type === 'Kid');
                   const tierBreakdown = [
                     ...TIER_OPTIONS
                       .filter(opt => opt.type !== 'Kid')
                       .map(opt => ({ label: opt.label, points: calculateBasePoints(opt.type, opt.participation) })),
                     { label: fr.tierNewbieLabel, points: newbiePoints },
                     { label: kidOption.label, points: calculateBasePoints(kidOption.type, kidOption.participation) }
                   ];
                   return tierBreakdown.map(tier => (
                     <div key={tier.label} className="flex justify-between items-center">
                       <span className="text-sm text-gray-600">{tier.label}</span>
                       <span className="text-lg font-bold text-green-700">
                         {formatCurrency(Math.ceil(tier.points * pricePerPoint))}
                       </span>
                     </div>
                   ));
                 })() : (
                   <div className="flex justify-between items-center">
                     <span className="text-sm text-gray-600">{fr.costVsPriceTitle}</span>
                     <span className="text-xl font-bold text-green-700">{fr.notSpecified}</span>
                   </div>
                 )}
               </div>
             </div>
{/* Budget Metrics */}
              <div className="bg-purple-50 border border-purple-100 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-700 mb-3">{fr.budgetTitle}</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{fr.budgetTotalCost}</span>
                    <span className="text-xl font-bold text-purple-700">
                      {activeEventState?.total_cost 
                        ? formatCurrency(activeEventState.total_cost)
                        : fr.notSpecified}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{fr.budgetTotalAmountDue}</span>
                    <span className="text-xl font-bold text-purple-700">
                      {formatCurrency(parties.reduce((sum, party) => sum + getRoundedPartyTotal(party), 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{fr.budgetAmountToReceive}</span>
                    <span className="text-xl font-bold text-purple-700">
                      {formatCurrency(parties.reduce((sum, party) => sum + (party.payment_status === PAYMENT_STATUS.UNPAID ? getRoundedPartyTotal(party) : 0), 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{fr.budgetAmountReceived}</span>
                    <span className="text-xl font-bold text-purple-700">
                      {formatCurrency(parties.reduce((sum, party) => sum + (party.payment_status === PAYMENT_STATUS.PAID ? getRoundedPartyTotal(party) : 0), 0))}
                    </span>
                  </div>
                </div>
              </div>
           </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-medium text-gray-700 mb-3">{fr.accommodation}</h3>
              <div className="space-y-2">
                {ACCOMMODATION_OPTIONS.map(opt => {
                  const count = parties.reduce((sum, p) => sum + (p.attendees || []).filter(a => a.sleeping_preference === opt.value).length, 0);
                  return count > 0 ? (
                    <div key={opt.value} className="flex justify-between items-center">
                      <span className="text-gray-700">{opt.label}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-700 mb-3">{fr.foodPreferences}</h3>
              <div className="space-y-2">
                {DIETARY_OPTIONS.filter(opt => opt.value !== 'none').map(opt => {
                  const count = parties.filter(p => {
                    const req = p.logistics?.food_requests?.requests;
                    return req && req.includes(opt.value);
                  }).length;
                  return count > 0 ? (
                    <div key={opt.value} className="flex justify-between items-center">
                      <span className="text-gray-700">{opt.label}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        </div>
      )}
{/* Dedicated Logistics View */}
      {activeEventState && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">{fr.logisticsViewTitle}</h2>
          <p className="text-sm text-gray-600 mb-4">{fr.logisticsViewDescription}</p>

          <div className="space-y-4">
            {parties.map(party => {
              const profile = party.profiles || {};
              const partyAttendees = party.attendees || [];
              const changes = logisticsChanges[party.id] || {};
              const hasChanges = changes.adminNotes !== undefined || (changes.attendees && Object.keys(changes.attendees).length > 0);

              return (
                <div key={party.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3 mb-3">
                    <div>
                      <button
                        onClick={() => openUserProfile(profile)}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                      >
                        {profile.full_name || fr.notSpecified}
                      </button>
                      <p className="text-sm text-gray-500">{profile.email}</p>
                    </div>
                    {hasChanges && (
                      <button
                        onClick={() => saveLogisticsChanges(party.id)}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 self-start"
                      >
                        {fr.saveAssignments}
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{fr.logisticsTableAttendee}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{fr.logisticsTableSleepingPref}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{fr.bedReason}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{fr.logisticsTableSleepingAssigned}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {partyAttendees.map((attendee, index) => {
                          const assignedValue = changes.attendees && changes.attendees[index] !== undefined
                            ? changes.attendees[index]
                            : (attendee.assigned_bed || '');

                          return (
                            <tr key={index}>
                              <td className="px-4 py-2 text-sm text-gray-800">{attendee.name || `${fr.participantFallback} #${index + 1}`}</td>
                              <td className="px-4 py-2 text-sm text-gray-800">
                                {getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference)}
                                {attendee.sleeping_preference === 'outside_other' && attendee.sleeping_preference_other && (
                                  <span className="block text-xs text-gray-500">{attendee.sleeping_preference_other}</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-800">
                                {getOptionLabel(BED_REASON_OPTIONS, attendee.bed_reason)}
                                {attendee.bed_reason === 'other' && attendee.bed_reason_other && (
                                  <span className="block text-xs text-gray-500">{attendee.bed_reason_other}</span>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                <input
                                  type="text"
                                  value={assignedValue}
                                  onChange={(e) => handleAssignedBedChange(party.id, index, e.target.value)}
                                  placeholder={fr.assignedBedPlaceholder}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">{fr.logisticsTableAdminNotes}</label>
                    <textarea
                      value={changes.adminNotes !== undefined ? changes.adminNotes : (party.admin_notes || '')}
                      onChange={(e) => handleAdminNotesChange(party.id, e.target.value)}
                      rows="2"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder={fr.adminNotesPlaceholder}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

{/* Admin User & Party Management */}
      {activeEventState && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">{fr.adminUsersManagementTitle}</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.logisticsTableName}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.logisticsTableEmail}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.adminTableHeader}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.paymentStatus}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.amountDue}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.actionsTableHeader}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {parties.map(party => {
                  const profile = party.profiles || {};
                  const isCurrentAdmin = profile.id === currentUserId;
                  return (
                    <tr key={party.id}>
                      <td className="px-4 py-3 text-sm text-gray-800">
                        <button 
                          onClick={() => openUserProfile(profile)}
                          className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                        >
                          {profile.full_name || fr.notSpecified}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-800">{profile.email}</td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!!profile.is_admin}
                          onChange={e => handleAdminToggle(profile, e.target.checked)}
                          disabled={isCurrentAdmin}
                          className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handlePaymentToggle(party, party.payment_status === PAYMENT_STATUS.PAID ? PAYMENT_STATUS.UNPAID : PAYMENT_STATUS.PAID)}
                          className={`px-3 py-1 text-xs rounded-full font-medium ${
                            party.payment_status === PAYMENT_STATUS.PAID
                              ? 'bg-green-100 text-green-800 hover:bg-green-200'
                              : 'bg-red-100 text-red-800 hover:bg-red-200'
                          }`}
                        >
                          {getPaymentStatusShortLabel(party.payment_status)}
                        </button>
                      </td>
<td className="px-4 py-3 text-sm text-gray-800">{formatCurrency(getRoundedPartyTotal(party))}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openPartyEdit(party)}
                          className="px-3 py-1 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
                        >
                          {fr.editRegistrationButton}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

{/* Scenario Simulator */}
      {activeEventState && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">{fr.scenarioSimulatorTitle}</h2>
          <p className="text-sm text-gray-600 mb-6">{fr.scenarioSimulatorSubtitle}</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{fr.scenarioAdultWholeCount}</label>
              <input
                type="number"
                min="0"
                value={scenarioValues.adultWhole}
                onChange={(e) => handleScenarioChange('adultWhole', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{fr.scenarioAdultMainCount}</label>
              <input
                type="number"
                min="0"
                value={scenarioValues.adultMain}
                onChange={(e) => handleScenarioChange('adultMain', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{fr.scenarioTeenWholeCount}</label>
              <input
                type="number"
                min="0"
                value={scenarioValues.teenWhole}
                onChange={(e) => handleScenarioChange('teenWhole', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{fr.scenarioTeenMainCount}</label>
              <input
                type="number"
                min="0"
                value={scenarioValues.teenMain}
                onChange={(e) => handleScenarioChange('teenMain', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{fr.scenarioKidsCount}</label>
              <input
                type="number"
                min="0"
                value={scenarioValues.kids}
                onChange={(e) => handleScenarioChange('kids', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{fr.scenarioSellingPriceOverride} {fr.currencyCadSuffix}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={scenarioValues.sellingPriceOverride}
                onChange={(e) => handleScenarioChange('sellingPriceOverride', e.target.value)}
                placeholder={activeEventState?.selling_price_whole_event || fr.currentSellingPricePlaceholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{fr.scenarioPricePerPointOverride} {fr.currencyCadSuffix}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={scenarioValues.pricePerPointOverride}
                onChange={(e) => handleScenarioChange('pricePerPointOverride', e.target.value)}
                placeholder={activeEventState?.selling_price_whole_event ? (activeEventState.selling_price_whole_event / 2).toFixed(2) : fr.currentPricePerPointPlaceholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>


          
          <div className="flex justify-between items-center">
            <button
              onClick={runSimulation}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-300"
            >
              {fr.scenarioSimulateButton}
            </button>
            
            {simulationResult && (
              <div className="text-right">
                <p className="text-sm text-gray-600 mb-1">{fr.scenarioResults}</p>
                <div className="space-y-1">
                  <p className="text-sm"><strong>{fr.scenarioTotalPoints}:</strong> {simulationResult.totalPoints.toFixed(2)}</p>
                  <p className="text-sm"><strong>{fr.scenarioBasePricePerPoint}:</strong> {formatCurrency(simulationResult.basePricePerPoint)}</p>
                  <p className="text-sm font-bold text-green-700"><strong>{fr.scenarioCalculatedAmountOwed}:</strong> {formatCurrency(simulationResult.calculated_amount_owed)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

{/* Data Export */}
      {activeEventState && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">{fr.dataExportTitle}</h2>
          <p className="text-sm text-gray-600 mb-6">{fr.dataExportDescription}</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-700 mb-3">{fr.exportCsvSectionTitle}</h3>
              <p className="text-sm text-gray-600 mb-4">{fr.exportCsvSectionDescription}</p>
              <button
                onClick={exportToCSV}
                disabled={!parties.length}
                className={`px-6 py-3 font-medium rounded-lg ${
                  parties.length 
                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {fr.exportCSVButton}
              </button>
            </div>
            
            <div className="border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-700 mb-3">{fr.exportGoogleSheetsSectionTitle}</h3>
              <p className="text-sm text-gray-600 mb-2">{fr.exportGoogleSheetsSectionDescription}</p>
              <p className="text-xs text-gray-500 mb-4">{fr.exportCopyTSVSubtext}</p>
              <button
                onClick={copyToClipboardForSheets}
                disabled={!parties.length}
                className={`px-6 py-3 font-medium rounded-lg ${
                  parties.length 
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {fr.exportCopyTSVButton}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Feedback */}
      <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">{fr.adminFeedbackSectionTitle}</h2>
          <label className="flex items-center space-x-2 text-sm text-gray-600">
            <input type="checkbox" checked={showResolvedFeedback} onChange={(e) => setShowResolvedFeedback(e.target.checked)} className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500" />
            <span>{fr.adminFeedbackShowResolved}</span>
          </label>
        </div>
        {(() => {
          const visibleFeedback = feedbackItems.filter(item => showResolvedFeedback || !item.is_resolved);
          if (visibleFeedback.length === 0) {
            return <p className="text-gray-500">{fr.adminFeedbackEmpty}</p>;
          }
          return (
            <div className="space-y-4">
              {visibleFeedback.map(item => (
                <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{item.profiles?.full_name || item.profiles?.email || fr.adminFeedbackUnknownAuthor}</p>
                      <p className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString('fr-CA')}</p>
                    </div>
                    {item.is_resolved ? (
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">{fr.adminFeedbackResolved}</span>
                    ) : (
                      <button
                        onClick={() => handleResolveFeedback(item.id)}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      >
                        {fr.adminFeedbackResolve}
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.content}</p>
                  {item.screenshot_url && (
                    <img src={item.screenshot_url} alt={fr.feedbackScreenshotAlt} className="mt-3 max-h-48 rounded-lg border border-gray-200" />
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* User Profile Modal */}
      {userProfileModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">{fr.userProfileModalTitle}</h2>
              <button onClick={closeUserProfile} className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100">
                ✕
              </button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">{fr.userProfileEmail}</h3>
                    <p className="text-gray-800">{userProfileModal.email}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">{fr.userProfileFullName}</h3>
                    <p className="text-gray-800">{userProfileModal.full_name || fr.notSpecified}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">{fr.userProfileAdminStatus}</h3>
                    <p className="text-gray-800">{userProfileModal.is_admin ? fr.userProfileYes : fr.userProfileNo}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">{fr.userProfileMemberSince}</h3>
                    <p className="text-gray-800">{formatDate(userProfileModal.created_at)}</p>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-lg font-medium text-gray-700 mb-4">{fr.userProfileEventHistory}</h3>
                {userEventHistory.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.eventHistoryTableEvent}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.eventHistoryTableDate}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.eventHistoryTableStatus}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.eventHistoryTablePayment}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.eventHistoryTableAmount}</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">{fr.eventHistoryTableWaitlisted}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {userEventHistory.map((history, index) => (
                          <tr key={index}>
                            <td className="px-4 py-3 text-sm text-gray-800">{history.event_theme}</td>
                            <td className="px-4 py-3 text-sm text-gray-800">{formatDate(history.registration_date)}</td>
                            <td className="px-4 py-3 text-sm text-gray-800">{history.registration_status}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 text-xs rounded-full ${
                                history.payment_status === PAYMENT_STATUS.PAID 
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {getPaymentStatusShortLabel(history.payment_status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-800">{formatCurrency(history.calculated_amount_owed)}</td>
                            <td className="px-4 py-3 text-sm text-gray-800">{history.is_waitlisted ? fr.userProfileYes : fr.userProfileNo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">{fr.noEventHistoryFound}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* God-Mode editing modal */}
      {editingParty && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">{fr.adminEditRegistrationTitle}</h2>
              <button onClick={closePartyEdit} className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100">
                ✕
              </button>
            </div>
            <div className="p-6">
              <RegistrationForm
                event={activeEventState}
                userRegistration={editingParty}
                adminMode={true}
                onAdminSave={handleAdminSave}
                onCancel={closePartyEdit}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminView;




