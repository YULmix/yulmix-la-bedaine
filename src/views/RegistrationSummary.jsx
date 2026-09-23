import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import {
  ACCOMMODATION_OPTIONS,
  BED_REASON_OPTIONS,
  DIETARY_OPTIONS,
  VOLUNTEERING_OPTIONS,
  TRANSPORT_TYPES,
  getOptionLabel,
  getDietaryRequestsLabel
} from '../lib/registrationOptions';

const RegistrationSummary = ({ registration, event, onEdit, onBackToHome }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editHistory, setEditHistory] = useState([]);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Handle registration deletion
  const handleDeleteRegistration = async () => {
    if (!window.confirm(fr.deleteRegistrationConfirm || 'Êtes-vous sûr de vouloir supprimer cette inscription? Cette action est irréversible.')) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('user_parties')
        .delete()
        .eq('id', registration.id);

      if (deleteError) throw deleteError;

      // Show success message and reload page
      alert(fr.deleteRegistrationSuccess || 'Inscription supprimée avec succès');
      window.location.reload();
    } catch (err) {
      console.error('Error deleting registration:', err);
      setError(fr.deleteRegistrationError || 'Erreur lors de la suppression de l\'inscription');
      alert(fr.deleteRegistrationError || 'Erreur lors de la suppression de l\'inscription');
    } finally {
      setLoading(false);
    }
  };
  // Format change description from JSON changes
  const formatChangeDescription = (changes) => {
    if (!changes || typeof changes !== 'object') return 'Aucun changement détaillé';
    
    const messages = [];
    
    // Helper to format values based on field type
    const formatValue = (field, value) => {
      if (value === null || value === undefined || value === '') return 'vide';
      
      switch (field) {
        case 'calculated_amount_owed':
          return formatCurrency(Number(value) || 0);
        case 'attendees':
          if (Array.isArray(value)) {
            return `${value.length} participant${value.length !== 1 ? 's' : ''}`;
          }
          return JSON.stringify(value);
        case 'counts':
          if (typeof value === 'object') {
            const counts = value;
            return `Adultes (fin de semaine): ${counts.adult_whole || 0}, Adultes (événement principal): ${counts.adult_main || 0}, Ados (fin de semaine): ${counts.teen_whole || 0}, Ados (événement principal): ${counts.teen_main || 0}, Enfants: ${counts.kids || 0}`;
          }
          return JSON.stringify(value);
        case 'logistics':
          if (typeof value === 'object') {
            const logistics = value;
            const parts = [];
            if (logistics.sleeping?.pref) parts.push(`Hébergement: ${getOptionLabel(ACCOMMODATION_OPTIONS, logistics.sleeping.pref, logistics.sleeping.pref)}`);
            if (logistics.food_requests?.requests) parts.push(`Demandes alimentaires: ${getDietaryRequestsLabel(logistics.food_requests.requests)}`);
            if (logistics.volunteering?.length > 0) parts.push(`Bénévolat: ${logistics.volunteering.length} option(s)`);
            return parts.join(', ') || 'Aucune information';
          }
          return JSON.stringify(value);
        case 'transport':
          if (typeof value === 'object') {
            const transport = value;
            return `${getOptionLabel(TRANSPORT_TYPES, transport.type, 'Aucun')}, Sièges: ${transport.seats || 0}`;
          }
          return JSON.stringify(value);
        case 'status':
          return value === 'Enregistré' ? 'Enregistré' : value === 'En attente' ? 'En attente' : value;
        case 'payment_status':
          return value === 'Payé' ? 'Payé' : value === 'Impayé' ? 'En attente de paiement' : value;
        case 'is_waitlisted':
          return value ? 'Oui' : 'Non';
        default:
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
      }
    };

    // Process each field
    Object.entries(changes).forEach(([field, data]) => {
      if (data && typeof data === 'object' && 'old' in data && 'new' in data) {
        const oldValue = formatValue(field, data.old);
        const newValue = formatValue(field, data.new);
        
        let fieldLabel = field;
        switch (field) {
          case 'attendees': fieldLabel = 'Participants'; break;
          case 'counts': fieldLabel = 'Décompte des participants'; break;
          case 'logistics': fieldLabel = 'Logistique'; break;
          case 'transport': fieldLabel = 'Transport'; break;
          case 'music_requests': fieldLabel = 'Demandes musicales'; break;
          case 'message_to_organizers': fieldLabel = 'Message aux organisateurs'; break;
          case 'confirmation_message': fieldLabel = 'Message de confirmation'; break;
          case 'status': fieldLabel = 'Statut'; break;
          case 'calculated_amount_owed': fieldLabel = 'Montant dû'; break;
          case 'payment_status': fieldLabel = 'Statut de paiement'; break;
          case 'is_waitlisted': fieldLabel = 'Liste d\'attente'; break;
          case 'admin_notes': fieldLabel = 'Notes des administrateurs'; break;
          default: fieldLabel = field.replace(/_/g, ' ');
        }
        
        messages.push(`${fieldLabel}: ${oldValue} → ${newValue}`);
      }
    });
    
    return messages.length > 0 ? messages.join('\n') : 'Aucun changement détecté';
  };

  useEffect(() => {
    const loadEditHistory = async () => {
      if (!registration?.id) return;
      
      setLoadingHistory(true);
      try {
        const { data, error } = await supabase
          .from('registration_edits')
          .select('*')
          .eq('registration_id', registration.id)
          .order('edited_at', { ascending: false });
        
        if (error) throw error;
        setEditHistory(data || []);
      } catch (err) {
        console.error("Erreur lors du chargement de l'historique des modifications:", err);
        setError(err.message);
      } finally {
        setLoadingHistory(false);
      }
    };

    loadEditHistory();
  }, [registration]);

  if (!registration) {
    return (
      <div className="text-center py-12">
        <div className="inline-block p-4 bg-gray-100 rounded-full mb-4">
          <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-700 mb-2">{fr.noRegistration}</h3>
        <button
          onClick={onBackToHome}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          {fr.backToHome}
        </button>
      </div>
    );
  }
  const attendees = registration.attendees || [];
  const logistics = registration.logistics || {};
  const transport = registration.transport || {};
  const volunteeringSelections = logistics.volunteering || [];

  // Get status label
  const getStatusLabel = (status) => {
    switch (status) {
      case 'Enregistré': return 'Enregistré';
      case 'En attente': return 'En attente';
      default: return status;
    }
  };

  // Get payment status label
  const getPaymentLabel = (paymentStatus) => {
    switch (paymentStatus) {
      case 'Payé': return 'Payé';
      case 'Impayé': return 'En attente de paiement';
      default: return paymentStatus;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{fr.registrationSummary}</h2>
          <p className="text-gray-600 mt-2">
            Événement: <span className="font-semibold">{event?.theme || 'N/A'}</span>
          </p>
        </div>
        <div className="flex space-x-4">
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            {fr.editRegistration}
          </button>
        </div>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: Attendees & Logistics */}
        <div className="lg:col-span-2 space-y-8">
          {/* Attendees list */}
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.attendeesList}</h3>
            <div className="space-y-4">
              {attendees.map((attendee, index) => (
                <div key={index} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-800">{attendee.name}</p>
                    <div className="flex items-center space-x-4 mt-1 text-sm text-gray-600">
                      <span>Type: {attendee.type === 'Adult' ? 'Adulte' : attendee.type === 'Teenager' ? 'Adolescent' : 'Enfant'}</span>
                      <span>Participation: {attendee.participation === 'Whole' ? 'Complète' : 'Partielle'}</span>
                      {attendee.is_new_member && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                           Première fois à la Bédaine
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Hébergement</p>
                    <p className="font-medium">
                      {attendee.sleeping_preference === 'camping' && fr.accommodationCamping}
                      {attendee.sleeping_preference === 'floor' && fr.accommodationFloor}
                      {attendee.sleeping_preference === 'bed' && fr.accommodationBed}
                      {attendee.sleeping_preference === 'sofa' && fr.accommodationSofa}
                      {!attendee.sleeping_preference && 'Non spécifié'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
{/* Logistics summary */}
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.logisticsSummary}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Hébergement</h4>
                <div className="space-y-2">
                  <p><span className="text-gray-600">Préférence:</span> {getOptionLabel(ACCOMMODATION_OPTIONS, logistics.sleeping?.pref, 'Non spécifié')}</p>
                  {logistics.sleeping?.reason && (
                    <p><span className="text-gray-600">Raison pour lit:</span> {getOptionLabel(BED_REASON_OPTIONS, logistics.sleeping.reason, logistics.sleeping.reason)}</p>
                  )}
                </div>
              </div>
              <div>
                <h4 className="font-medium text-gray-700 mb-2">{fr.foodRequirements}</h4>
                <div className="space-y-2">
                  <p><span className="text-gray-600">Demandes:</span> {getDietaryRequestsLabel(logistics.food_requests?.requests, 'Aucune')}</p>
                  {logistics.food_requests?.notes && (
                    <p><span className="text-gray-600">Notes:</span> {logistics.food_requests.notes}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Transport & Volunteering */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Transport */}
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.transportSummary}</h3>
              <div className="space-y-3">
                <p><span className="text-gray-600">Type:</span> {getOptionLabel(TRANSPORT_TYPES, transport.type, 'Non spécifié')}</p>
                <p><span className="text-gray-600">Sièges:</span> {transport.seats || 0}</p>
                <p><span className="text-gray-600">Arrivée:</span> {transport.arrival ? formatDate(transport.arrival) : 'Non spécifié'}</p>
                <p><span className="text-gray-600">Départ:</span> {transport.departure ? formatDate(transport.departure) : 'Non spécifié'}</p>
              </div>
            </div>

            {/* Volunteering */}
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.volunteeringSummary}</h3>
              {volunteeringSelections.length > 0 ? (
                <ul className="space-y-2">
                  {volunteeringSelections.map((item, index) => (
                    <li key={index} className="flex items-center">
                      <svg className="w-4 h-4 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                      </svg>
                      <span>{getOptionLabel(VOLUNTEERING_OPTIONS, item, item)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">Aucun bénévolat sélectionné</p>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Status & Price */}
        <div className="space-y-8">
          {/* Status card */}
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Statut</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">{fr.registrationStatus}</p>
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium mt-1 ${
                  registration.status === 'Enregistré' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {getStatusLabel(registration.status)}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500">{fr.paymentStatus}</p>
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium mt-1 ${
                  registration.payment_status === 'Payé' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {getPaymentLabel(registration.payment_status)}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500">{fr.amountDue}</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                  {formatCurrency(registration.calculated_amount_owed || 0)}
                </p>
              </div>
              {registration.is_waitlisted && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
                  <p className="font-medium">Sur liste d'attente</p>
                  <p className="text-sm mt-1">Vous êtes sur la liste d'attente pour cet événement.</p>
                </div>
              )}
            </div>
          </div>
{/* Edit history */}
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Historique</h3>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-500">{fr.lastEdited}</p>
                <p className="font-medium">{registration.last_edited_at ? formatDate(registration.last_edited_at) : 'Jamais modifié'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">{fr.editCount}</p>
                <p className="font-medium">{registration.edit_count || 0}</p>
              </div>
              {editHistory.length > 0 && (
                <>
                  <button
                    onClick={() => setShowEditHistory(!showEditHistory)}
                    className="w-full mt-4 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                      disabled={loadingHistory}
                  >
                    {loadingHistory ? 'Chargement...' : showEditHistory ? "Masquer l'historique" : fr.viewEditHistory}
                  </button>
                  {showEditHistory && (
                    <div className="mt-4 space-y-3">
                      {editHistory.map((edit) => (
                        <div key={edit.id} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex justify-between items-start mb-3">
                                <div>
                                  <p className="font-medium text-gray-700">{formatDate(edit.edited_at)}</p>
                                  <p className="text-xs text-gray-500 mt-1">Modification #{editHistory.length - editHistory.indexOf(edit)}</p>
                                </div>
                                <p className="text-sm text-gray-500">par {edit.edited_by ? edit.edited_by.substring(0, 8) + '...' : 'Système'}</p>
                              </div>
                              <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded border border-gray-100">
                                <div className="font-medium text-gray-800 mb-2">Changements apportés:</div>
                                <div className="space-y-2">
                                  {formatChangeDescription(edit.changes)
                                    .split('\n')
                                    .map((line, idx) => (
                                      <div key={idx} className="flex items-start">
                                        <span className="text-gray-500 mr-2">•</span>
                                        <span className="whitespace-normal">{line}</span>
                                      </div>
                                    ))}
                                </div>
                                {edit.changes && Object.keys(edit.changes).length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-gray-200">
                                    <button
                                      onClick={() => {
                                        const details = JSON.stringify(edit.changes, null, 2);
                                        navigator.clipboard.writeText(details);
                                        alert('Détails copiés dans le presse-papiers');
                                      }}
                                      className="text-xs text-blue-600 hover:text-blue-800"
                                    >
                                      Copier les détails JSON
                                    </button>
                                  </div>
                                )}
                              </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Special requests */}
          {(registration.music_requests || registration.message_to_organizers) && (
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.specialRequests}</h3>
              <div className="space-y-4">
                {registration.music_requests && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Demandes musicales</p>
                    <p className="text-gray-800">{registration.music_requests}</p>
                  </div>
                )}
                {registration.message_to_organizers && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Message aux organisateurs</p>
                    <p className="text-gray-800">{registration.message_to_organizers}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-8 pt-6 border-t border-gray-200 flex justify-end">
        <div className="flex space-x-4">
          <button
            onClick={handleDeleteRegistration}
            disabled={loading}
            className="px-6 py-3 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Suppression...' : (fr.deleteRegistration || 'Supprimer l\'inscription')}
          </button>
          <button
            onClick={onEdit}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            {fr.editRegistration}
          </button>
        </div>
      </div>
    </div>

  );
};

export default RegistrationSummary;