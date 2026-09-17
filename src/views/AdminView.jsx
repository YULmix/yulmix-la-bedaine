import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import RegistrationForm from '../components/RegistrationForm';
import {
  ACCOMMODATION_OPTIONS,
  DIETARY_OPTIONS,
  getOptionLabel,
  getDietaryRequestsLabel
} from '../lib/registrationOptions';

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
  const [realtimeChannel, setRealtimeChannel] = useState(null);

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
    } catch (err) {
      console.error('Error fetching admin data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
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
      addToast('Un événement est déjà actif. Veuillez l\'archiver avant d\'en activer un nouveau.', 'error');
      return;
    }
    try {
      const { error } = await supabase
        .from('events')
        .update({ is_active: true, status: 'ACTIVE' })
        .eq('id', event.id);
      if (error) {
        if (error.code === '23505') {
          addToast('Un événement est déjà actif. Veuillez l\'archiver avant d\'en activer un nouveau.', 'error');
        } else {
          throw error;
        }
      } else {
        addToast(`Événement "${event.theme}" activé`, 'success');
        fetchAllData();
      }
    } catch (err) {
      console.error('Error activating event:', err);
      addToast(err.message || 'Erreur lors de l\'activation', 'error');
    }
  };

  const handleArchiveEvent = async (event) => {
    try {
      const { error } = await supabase
        .from('events')
        .update({ is_active: false, status: 'ARCHIVED' })
        .eq('id', event.id);
      if (error) throw error;
      addToast(`Événement "${event.theme}" archivé`, 'success');
      fetchAllData();
    } catch (err) {
      console.error('Error archiving event:', err);
      addToast(err.message || 'Erreur lors de l\'archivage', 'error');
    }
  };

  // Inline editing for event metadata
  const handleEventFieldChange = (field, value) => {
    setEventChanges(prev => ({ ...prev, [field]: value }));
  };

  const saveEventChanges = async () => {
    if (!editingEvent || Object.keys(eventChanges).length === 0) return;
    try {
      const { error } = await supabase
        .from('events')
        .update(eventChanges)
        .eq('id', editingEvent.id);
      if (error) throw error;
      addToast('Métadonnées de l\'événement mises à jour', 'success');
      setEventChanges({});
      setEditingEvent(null);
      fetchAllData();
    } catch (err) {
      console.error('Error updating event:', err);
      addToast(err.message || 'Erreur lors de la mise à jour', 'error');
    }
  };

  // Admin checkbox toggle (prevent self-escalation)
  const handleAdminToggle = async (profile, checked) => {
    if (profile.id === supabase.auth.getUser()?.user?.id) {
      addToast('Vous ne pouvez pas modifier votre propre statut administrateur.', 'warning');
      return;
    }
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_admin: checked })
        .eq('id', profile.id);
      if (error) throw error;
      addToast(`Statut admin ${checked ? 'activé' : 'désactivé'} pour ${profile.email}`, 'success');
      fetchAllData();
    } catch (err) {
      console.error('Error updating admin status:', err);
      addToast(err.message || 'Erreur lors de la mise à jour', 'error');
    }
  };

  // Payment status toggle
  const handlePaymentToggle = async (party, newStatus) => {
    try {
      const { error } = await supabase
        .from('user_parties')
        .update({ payment_status: newStatus })
        .eq('id', party.id);
      if (error) throw error;
      addToast(`Statut de paiement mis à jour: ${newStatus === 'Payé' ? 'Payé' : 'Impayé'}`, 'success');
      fetchParties(activeEventState.id);
    } catch (err) {
      console.error('Error updating payment status:', err);
      addToast(err.message || 'Erreur lors de la mise à jour', 'error');
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
    addToast('Modifications enregistrées', 'success');
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

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          <p>Accès réservé aux administrateurs.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-600">Chargement du tableau de bord...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Tableau de bord administrateur</h1>
        <p className="text-gray-600">Gestion des événements, inscriptions et utilisateurs</p>
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
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Gestion des événements</h2>
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
                  {event.status === 'ACTIVE' ? 'En cours' : event.status === 'ARCHIVED' ? 'Archivé' : 'Brouillon'}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-3">{event.description?.substring(0, 100)}...</p>
              <div className="flex space-x-2">
                {!event.is_active && event.status !== 'ARCHIVED' && (
                  <button
                    onClick={() => handleActivateEvent(event)}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    Activer
                  </button>
                )}
                {event.is_active && (
                  <button
                    onClick={() => handleArchiveEvent(event)}
                    className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                  >
                    Archiver
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
                    Modifier
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
              <h2 className="text-xl font-bold text-gray-800">Modifier les métadonnées de l'événement</h2>
              <button onClick={() => setEditingEvent(null)} className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100">
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Thème</label>
                <input type="text" value={eventChanges.theme ?? editingEvent.theme} onChange={e => handleEventFieldChange('theme', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Coût total (CAD)</label>
                <input type="number" step="0.01" value={eventChanges.total_cost ?? editingEvent.total_cost} onChange={e => handleEventFieldChange('total_cost', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Durée (jours)</label>
                <input type="number" value={eventChanges.duration_days ?? editingEvent.duration_days} onChange={e => handleEventFieldChange('duration_days', parseInt(e.target.value) || 2)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Points de contact</label>
                <textarea value={eventChanges.points_of_contact ?? editingEvent.points_of_contact} onChange={e => handleEventFieldChange('points_of_contact', e.target.value)} rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date de début des inscriptions</label>
                <input type="date" value={eventChanges.reg_start_date ?? editingEvent.reg_start_date} onChange={e => handleEventFieldChange('reg_start_date', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end space-x-3">
              <button onClick={() => setEditingEvent(null)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Annuler</button>
              <button onClick={saveEventChanges} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Enregistrer</button>
            </div>
          </div>
        </div>
      )}
      {/* Real-time Aggregate Dashboard */}
      {activeEventState && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-800">Tableau de bord agrégé</h2>
            <div className="text-sm text-gray-500">Événement actif: <strong>{activeEventState.theme}</strong></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-blue-700">{parties.reduce((sum, p) => sum + (p.counts?.adult_whole || 0) + (p.counts?.adult_main || 0), 0)}</div>
              <div className="text-sm text-blue-600 mt-1">Adultes</div>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-green-700">{parties.reduce((sum, p) => sum + (p.counts?.teen_whole || 0) + (p.counts?.teen_main || 0), 0)}</div>
              <div className="text-sm text-green-600 mt-1">Adolescents</div>
            </div>
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-purple-700">{parties.reduce((sum, p) => sum + (p.counts?.kids || 0), 0)}</div>
              <div className="text-sm text-purple-600 mt-1">Enfants</div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
              <div className="text-3xl font-bold text-amber-700">{parties.length}</div>
              <div className="text-sm text-amber-600 mt-1">Groupes inscrits</div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-medium text-gray-700 mb-3">Hébergement</h3>
              <div className="space-y-2">
                {ACCOMMODATION_OPTIONS.map(opt => {
                  const count = parties.filter(p => p.logistics?.sleeping?.pref === opt.value).length;
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
              <h3 className="text-lg font-medium text-gray-700 mb-3">Préférences alimentaires</h3>
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
      {/* Admin User & Party Management */}
      {activeEventState && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Gestion des utilisateurs et inscriptions</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Nom</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Courriel</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Admin</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Statut de paiement</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {parties.map(party => {
                  const profile = party.profiles || {};
                  const isCurrentAdmin = profile.id === supabase.auth.getUser()?.user?.id;
                  return (
                    <tr key={party.id}>
                      <td className="px-4 py-3 text-sm text-gray-800">{profile.full_name || 'Non spécifié'}</td>
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
                          onClick={() => handlePaymentToggle(party, party.payment_status === 'Payé' ? 'Impayé' : 'Payé')}
                          className={`px-3 py-1 text-xs rounded-full font-medium ${
                            party.payment_status === 'Payé' 
                              ? 'bg-green-100 text-green-800 hover:bg-green-200'
                              : 'bg-red-100 text-red-800 hover:bg-red-200'
                          }`}
                        >
                          {party.payment_status === 'Payé' ? 'Payé' : 'Impayé'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openPartyEdit(party)}
                          className="px-3 py-1 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
                        >
                          Éditer l'inscription
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
      {/* God-Mode editing modal */}
      {editingParty && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Édition admin de l'inscription</h2>
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