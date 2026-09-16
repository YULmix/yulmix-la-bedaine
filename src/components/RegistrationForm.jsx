import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { calculateBasePoints, calculatePricePerPointFromSellingPrice, simulateEventPricing } from '../lib/pricingEngine';
import fr from '../locales/fr.json';
import {
  TIER_OPTIONS,
  ACCOMMODATION_OPTIONS,
  BED_REASON_OPTIONS,
  VOLUNTEERING_OPTIONS,
  TRANSPORT_TYPES,
  DIETARY_OPTIONS
} from '../lib/registrationOptions';

const RegistrationForm = ({ event, userRegistration, onRegistrationSuccess, onCancel }) => {
  const [attendees, setAttendees] = useState([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [estimatedBalance, setEstimatedBalance] = useState(0);
  const [basePricePerPoint, setBasePricePerPoint] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

const [sameForEveryone, setSameForEveryone] = useState(true);
  const [transportType, setTransportType] = useState('');
  const [transportSeats, setTransportSeats] = useState(0);
  const [transportArrival, setTransportArrival] = useState('');
  const [transportDeparture, setTransportDeparture] = useState('');
  const [volunteeringSelections, setVolunteeringSelections] = useState([]);
  const [musicRequests, setMusicRequests] = useState('');
  const [messageToOrganizers, setMessageToOrganizers] = useState('');
  const [isWaitlisted, setIsWaitlisted] = useState(false);
  const [toasts, setToasts] = useState([]);
  // Initialize with existing registration or default attendee
  useEffect(() => {
    if (userRegistration && userRegistration.attendees) {
      // Convert stored attendees to form format
      const formattedAttendees = userRegistration.attendees.map((attendee, index) => ({
        id: `attendee-${index}`,
        name: attendee.name || '',
        type: attendee.type || 'Adult',
        participation: attendee.participation || 'Whole',
        isNewMember: attendee.is_new_member || false,
        sleepingPreference: attendee.sleeping_preference || '',
        dietaryNeeds: attendee.dietary_needs || '',
        bedReason: attendee.bed_reason || '',
        dietaryOther: attendee.dietary_other || ''
      }));
      setAttendees(formattedAttendees);
      // Set party-wide logistics from userRegistration metadata if present
      if (userRegistration.transport?.type !== undefined) setTransportType(userRegistration.transport.type);
      if (userRegistration.transport?.seats !== undefined) setTransportSeats(userRegistration.transport.seats);
      // Convert ISO datetime strings to datetime-local format (YYYY-MM-DDTHH:mm) if needed
      if (userRegistration.transport?.arrival) {
        const arrival = userRegistration.transport.arrival;
        // If it's a full ISO string with timezone/seconds, strip to datetime-local format
        const dtLocal = arrival.includes('T') ? arrival.slice(0, 16) : arrival;
        setTransportArrival(dtLocal);
      }
      if (userRegistration.transport?.departure) {
        const departure = userRegistration.transport.departure;
        const dtLocal = departure.includes('T') ? departure.slice(0, 16) : departure;
        setTransportDeparture(dtLocal);
      }
      if (userRegistration.logistics?.volunteering) setVolunteeringSelections(userRegistration.logistics.volunteering);
      if (userRegistration.music_requests) setMusicRequests(userRegistration.music_requests);
      if (userRegistration.message_to_organizers) setMessageToOrganizers(userRegistration.message_to_organizers);
      if (userRegistration.is_waitlisted) setIsWaitlisted(userRegistration.is_waitlisted);
    } else {
      // Start with one empty attendee
      setAttendees([{ id: 'attendee-1', name: '', type: 'Adult', participation: 'Whole', isNewMember: false, sleepingPreference: '', dietaryNeeds: '', bedReason: '', dietaryOther: '' }]);
    }
  }, [userRegistration]);

  // Sync logistics across attendees when "same for everyone" is enabled
  useEffect(() => {
    if (sameForEveryone && attendees.length > 0) {
      const firstAttendee = attendees[0];
      // Check if any attendee differs from first attendee
      const needsSync = attendees.some(att => 
        att.sleepingPreference !== firstAttendee.sleepingPreference ||
        att.dietaryNeeds !== firstAttendee.dietaryNeeds ||
        att.bedReason !== firstAttendee.bedReason ||
        att.dietaryOther !== firstAttendee.dietaryOther
      );
      if (needsSync) {
        setAttendees(attendees.map(att => ({
          ...att,
          sleepingPreference: firstAttendee.sleepingPreference,
          dietaryNeeds: firstAttendee.dietaryNeeds,
          bedReason: firstAttendee.bedReason,
          dietaryOther: firstAttendee.dietaryOther
        })));
      }
    }
  }, [sameForEveryone, attendees]);
  // Recalculate points and balance when attendees or event changes
  useEffect(() => {
    if (!event) return;

    // Calculate total base points
    const points = attendees.reduce((sum, attendee) => {
      return sum + calculateBasePoints(attendee.type, attendee.participation);
    }, 0);
    setTotalPoints(points);

    // Calculate price per point
    const pricePerPoint = calculatePricePerPointFromSellingPrice(event.selling_price_whole_event || 0);
    setBasePricePerPoint(pricePerPoint);

    // Calculate estimated balance using simulation
    const simulation = simulateEventPricing(
      [{
        id: 'temp-party',
        is_paid: false,
        attendees: attendees.map(a => ({
          type: a.type,
          participation: a.participation,
          isNewMember: a.isNewMember
        }))
      }],
      event.selling_price_whole_event || 0
    );
    setEstimatedBalance(simulation.calculated_amount_owed);
  }, [attendees, event]);
  // Check capacity and waitlist status
  useEffect(() => {
    if (!event) return;
    const currentAttendeesCount = attendees.length;
    if (event.capacity && currentAttendeesCount > event.capacity) {
      setIsWaitlisted(true);
    } else {
      setIsWaitlisted(false);
    }
  }, [attendees, event]);

  const handleAddAttendee = () => {
    const newId = `attendee-${Date.now()}`;
    setAttendees([...attendees, { 
      id: newId, 
      name: '', 
      type: 'Adult', 
      participation: 'Whole', 
      isNewMember: false 
    }]);
  };
const handleRemoveAttendee = (id) => {
    if (attendees.length > 1) {
      setAttendees(attendees.filter(attendee => attendee.id !== id));
    }
  };

  const handleAttendeeChange = (id, field, value) => {
    setAttendees(attendees.map(attendee => 
      attendee.id === id ? { ...attendee, [field]: value } : attendee
    ));
  };

  const handleTierChange = (id, value) => {
    const option = TIER_OPTIONS.find(opt => opt.value === value);
    if (option) {
      setAttendees(attendees.map(attendee => 
        attendee.id === id ? { 
          ...attendee, 
          type: option.type, 
          participation: option.participation 
        } : attendee
      ));
    }
  };
  const addToast = (message, type = 'info') => {
    const id = Date.now();
    const newToast = { id, message, type };
    setToasts(prev => [...prev, newToast]);
    setTimeout(() => removeToast(id), 5000);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!event || !event.id) {
      setError('Événement non spécifié');
      addToast('Événement non spécifié', 'error');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Vous devez être connecté pour vous inscrire');

      // Prepare attendees data for storage
      const attendeesData = attendees.map(attendee => ({
        name: attendee.name.trim(),
        type: attendee.type,
        participation: attendee.participation,
        is_new_member: attendee.isNewMember,
        sleeping_preference: attendee.sleepingPreference,
        dietary_needs: attendee.dietaryNeeds,
        bed_reason: attendee.bedReason,
        dietary_other: attendee.dietaryOther
      }));

      // Calculate counts for the counts JSONB field
      const counts = {
        adult_whole: attendeesData.filter(a => a.type === 'Adult' && a.participation === 'Whole').length,
        adult_main: attendeesData.filter(a => a.type === 'Adult' && a.participation === 'Main').length,
        teen_whole: attendeesData.filter(a => a.type === 'Teenager' && a.participation === 'Whole').length,
        teen_main: attendeesData.filter(a => a.type === 'Teenager' && a.participation === 'Main').length,
        kids: attendeesData.filter(a => a.type === 'Kid').length
      };
      // Build logistics JSONB
      const logistics = {
        sleeping: {
          pref: attendees.length > 0 ? attendees[0].sleepingPreference : '',
          reason: attendees.length > 0 ? attendees[0].bedReason : '',
          assigned: ''
        },
        food_requests: {
          requests: attendees.map(a => a.dietaryNeeds).filter(Boolean).join(', '),
          notes: attendees.map(a => a.dietaryOther).filter(Boolean).join(', ')
        },
        volunteering: volunteeringSelections
      };
      
      // Build transport JSONB
      const transport = {
        type: transportType,
        seats: transportSeats,
        arrival: transportArrival,
        departure: transportDeparture
      };

      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;

      // Check if registration already exists
      const { data: existingRegistration, error: checkError } = await supabase
        .from('user_parties')
        .select('*')
        .eq('user_id', user.id)
        .eq('event_id', event.id)
        .maybeSingle();

      if (checkError) throw checkError;

      const registrationData = {
        user_id: user.id,
        event_id: event.id,
        attendees: attendeesData,
        counts: counts,
        calculated_amount_owed: estimatedBalance,
        status: 'Enregistré',
        payment_status: 'Impayé',
        is_waitlisted: isWaitlisted,
        logistics: logistics,
        transport: transport,
        music_requests: musicRequests,
        message_to_organizers: messageToOrganizers
      };

      let result;
      if (existingRegistration) {
        // Update existing registration
        result = await supabase
          .from('user_parties')
          .update(registrationData)
          .eq('id', existingRegistration.id);
      } else {
        // Create new registration
        result = await supabase
          .from('user_parties')
          .insert([registrationData]);
      }

      if (result.error) throw result.error;

      setSuccess(true);
      addToast(fr.registrationSuccess, 'success');
      if (onRegistrationSuccess) {
        onRegistrationSuccess();
      }
    } catch (err) {
      console.error('Erreur lors de l\'inscription:', err);
      setError(err.message);
      addToast(err.message, 'error');
    }

}
    const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2
    }).format(amount);
  };

    
      return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Inscription à l'événement</h2>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">✓ Votre inscription a été enregistrée avec succès!</div>}
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div key={toast.id} className={`px-4 py-3 rounded-lg shadow-lg border ${toast.type === 'success' ? 'bg-green-100 border-green-300 text-green-800' : toast.type === 'error' ? 'bg-red-100 border-red-300 text-red-800' : toast.type === 'warning' ? 'bg-yellow-100 border-yellow-300 text-yellow-800' : 'bg-blue-100 border-blue-300 text-blue-800'}`}>
            <div className="flex justify-between items-center">
              <span>{toast.message}</span>
              <button onClick={() => removeToast(toast.id)} className="ml-4 text-gray-500 hover:text-gray-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Attendee list */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-700">Participants de votre groupe</h3>
              <button type="button" onClick={handleAddAttendee} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">+ Ajouter un participant</button>
            </div>
            <div className="space-y-4">
              {attendees.map((attendee, index) => (
                <div key={attendee.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-medium text-gray-700">Participant #{index + 1}</h4>
                    {attendees.length > 1 && (
                      <button type="button" onClick={() => handleRemoveAttendee(attendee.id)} className="text-red-600 hover:text-red-800 text-sm">Supprimer</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nom complet</label>
                      <input type="text" value={attendee.name} onChange={(e) => handleAttendeeChange(attendee.id, 'name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Jean Tremblay" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Type de participation</label>
                      <select value={TIER_OPTIONS.find(opt => opt.type === attendee.type && opt.participation === attendee.participation)?.value || 'adult-whole'} onChange={(e) => handleTierChange(attendee.id, e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        {TIER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" checked={attendee.isNewMember} onChange={(e) => handleAttendeeChange(attendee.id, 'isNewMember', e.target.checked)} className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500" />
                        <span className="text-sm text-gray-700">Nouveau membre (70% de rabais)</span>
                      </label>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-gray-600">
                    Points: {calculateBasePoints(attendee.type, attendee.participation).toFixed(1)}
                    {attendee.isNewMember && ' (avec ajustement nouveau membre)'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Logistics per attendee */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 mt-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.accommodation}</h3>
            <div className="mb-4">
              <label className="flex items-center space-x-2">
                <input type="checkbox" checked={sameForEveryone} onChange={(e) => setSameForEveryone(e.target.checked)} className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500" />
                <span className="text-sm text-gray-700">{fr.sameForEveryone}</span>
              </label>
            </div>
            <div className="space-y-6">
              {attendees.map((attendee, index) => (
                <div key={`logistics-${attendee.id}`} className="p-4 border border-gray-100 rounded-lg bg-gray-50">
                  <div className="text-sm font-medium text-gray-800 mb-2">{attendee.name || `Participant ${index + 1}`}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{fr.accommodation}</label>
                      <select value={attendee.sleepingPreference} onChange={(e) => handleAttendeeChange(attendee.id, 'sleepingPreference', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        <option value="">Sélectionnez</option>
                        {ACCOMMODATION_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      {attendee.sleepingPreference === 'bed' && (
                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">{fr.bedReason}</label>
                          <select value={attendee.bedReason} onChange={(e) => handleAttendeeChange(attendee.id, 'bedReason', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <option value="">Sélectionnez</option>
                            {BED_REASON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{fr.dietaryNeeds}</label>
                      <select value={attendee.dietaryNeeds} onChange={(e) => handleAttendeeChange(attendee.id, 'dietaryNeeds', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        <option value="">Sélectionnez</option>
                        {DIETARY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      {attendee.dietaryNeeds === 'other' && (
                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">{fr.pleaseSpecify}</label>
                          <input type="text" value={attendee.dietaryOther} onChange={(e) => handleAttendeeChange(attendee.id, 'dietaryOther', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Spécifiez vos restrictions..." />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 text-sm text-gray-600">
              <p>{fr.accommodationNotice}</p>
              <p className="mt-2">{fr.foodNotice}</p>
            </div>
          </div>
          {/* Volunteering */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 mt-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.volunteering}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {VOLUNTEERING_OPTIONS.map(option => (
                <label key={option.value} className="flex items-center space-x-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <input type="checkbox" checked={volunteeringSelections.includes(option.value)} onChange={(e) => {
                    if (e.target.checked) {
                      setVolunteeringSelections([...volunteeringSelections, option.value]);
                    } else {
                      setVolunteeringSelections(volunteeringSelections.filter(v => v !== option.value));
                    }
                  }} className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500" />
                  <span className="text-sm text-gray-700">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          {/* Transport */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 mt-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.transport}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.transportType}</label>
                <select value={transportType} onChange={(e) => setTransportType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  <option value="">Sélectionnez</option>
                  {TRANSPORT_TYPES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.transportSeats}</label>
                <input type="number" min="0" max="20" value={transportSeats} onChange={(e) => setTransportSeats(parseInt(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.transportArrival}</label>
                <input type="datetime-local" value={transportArrival} onChange={(e) => setTransportArrival(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{fr.transportDeparture}</label>
                <input type="datetime-local" value={transportDeparture} onChange={(e) => setTransportDeparture(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
            </div>
          </div>
          {/* Music requests and message */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 mt-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.musicRequests}</h3>
            <textarea value={musicRequests} onChange={(e) => setMusicRequests(e.target.value)} rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Artistes, genres, chansons spécifiques..." />
          </div>
          <div className="bg-white rounded-lg p-6 border border-gray-200 mt-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">{fr.messageToOrganizers}</h3>
            <textarea value={messageToOrganizers} onChange={(e) => setMessageToOrganizers(e.target.value)} rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Questions, commentaires, besoins spéciaux..." />
          </div>
{/* Summary section */}
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Résumé de votre inscription</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
                <div className="text-3xl font-bold text-blue-600">{totalPoints.toFixed(1)}</div>
                <div className="text-sm text-gray-600 mt-1">Points totaux</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
                <div className="text-3xl font-bold text-green-600">{formatCurrency(basePricePerPoint)}</div>
                <div className="text-sm text-gray-600 mt-1">Prix de base par point</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
                <div className="text-3xl font-bold text-purple-600">{formatCurrency(estimatedBalance)}</div>
                <div className="text-sm text-gray-600 mt-1">Montant estimé dû</div>
              </div>
            </div>
            <div className="mt-6 text-sm text-gray-600">
              <p>Le calcul est basé sur le prix de vente pour un adulte participant à l'événement complet. Les nouveaux membres bénéficient d'une réduction de 70% sur le coût calculé.</p>
            </div>
          </div>

          {/* Submit button */}
          <div className="flex justify-end space-x-4">
            <button type="button" onClick={handleAddAttendee} className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">Ajouter un autre participant</button>
{onCancel && (
              <button type="button" onClick={onCancel} className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">Annuler</button>
            )}
            <button type="submit" disabled={isSubmitting} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Enregistrement en cours...' : 'Enregistrer l\'inscription'}</button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default RegistrationForm;



