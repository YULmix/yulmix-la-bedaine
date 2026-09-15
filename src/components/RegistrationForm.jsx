import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { calculateBasePoints, calculatePricePerPoint, simulateEventPricing } from '../lib/pricingEngine';

const TIER_OPTIONS = [
  { value: 'adult-whole', label: 'Adulte - Fin de semaine complÃ¨te', type: 'Adult', participation: 'Whole' },
  { value: 'adult-main', label: 'Adulte - Ã‰vÃ©nement principal', type: 'Adult', participation: 'Main' },
  { value: 'teen-whole', label: 'Ado - Fin de semaine complÃ¨te', type: 'Teenager', participation: 'Whole' },
  { value: 'teen-main', label: 'Ado - Ã‰vÃ©nement principal', type: 'Teenager', participation: 'Main' },
  { value: 'kid', label: 'Enfant', type: 'Kid', participation: 'After-Party' }
];

const RegistrationForm = ({ event, userRegistration, onRegistrationSuccess }) => {
  const [attendees, setAttendees] = useState([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [estimatedBalance, setEstimatedBalance] = useState(0);
  const [basePricePerPoint, setBasePricePerPoint] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Initialize with existing registration or default attendee
  useEffect(() => {
    if (userRegistration && userRegistration.attendees) {
      // Convert stored attendees to form format
      const formattedAttendees = userRegistration.attendees.map((attendee, index) => ({
        id: `attendee-${index}`,
        name: attendee.name || '',
        type: attendee.type || 'Adult',
        participation: attendee.participation || 'Whole',
        isNewMember: attendee.is_new_member || false
      }));
      setAttendees(formattedAttendees);
    } else {
      // Start with one empty attendee
      setAttendees([{ id: 'attendee-1', name: '', type: 'Adult', participation: 'Whole', isNewMember: false }]);
    }
  }, [userRegistration]);

  // Recalculate points and balance when attendees or event changes
  useEffect(() => {
    if (!event) return;

    // Calculate total base points
    const points = attendees.reduce((sum, attendee) => {
      return sum + calculateBasePoints(attendee.type, attendee.participation);
    }, 0);
    setTotalPoints(points);

    // Calculate price per point
    const pricePerPoint = calculatePricePerPoint(event.total_cost || 0, points);
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
      event.total_cost || 0
    );
    setEstimatedBalance(simulation.calculated_amount_owed);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!event || !event.id) {
      setError('Ã‰vÃ©nement non spÃ©cifiÃ©');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Vous devez Ãªtre connectÃ© pour vous inscrire');

      // Prepare attendees data for storage
      const attendeesData = attendees.map(attendee => ({
        name: attendee.name.trim(),
        type: attendee.type,
        participation: attendee.participation,
        is_new_member: attendee.isNewMember
      }));

      // Calculate counts for the counts JSONB field
      const counts = {
        adult_whole: attendeesData.filter(a => a.type === 'Adult' && a.participation === 'Whole').length,
        adult_main: attendeesData.filter(a => a.type === 'Adult' && a.participation === 'Main').length,
        teen_whole: attendeesData.filter(a => a.type === 'Teenager' && a.participation === 'Whole').length,
        teen_main: attendeesData.filter(a => a.type === 'Teenager' && a.participation === 'Main').length,
        kids: attendeesData.filter(a => a.type === 'Kid').length
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
        status: 'EnregistrÃ©',
        payment_status: 'ImpayÃ©',
        is_waitlisted: false
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
      if (onRegistrationSuccess) {
        onRegistrationSuccess();
      }
    } catch (err) {
      console.error('Erreur lors de l\'inscription:', err);
      setError(err.message);
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
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Inscription Ã  l'Ã©vÃ©nement</h2>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">âœ… Votre inscription a Ã©tÃ© enregistrÃ©e avec succÃ¨s!</div>}
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
{/* Summary section */}
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">RÃ©sumÃ© de votre inscription</h3>
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
                <div className="text-sm text-gray-600 mt-1">Montant estimÃ© dÃ»</div>
              </div>
            </div>
            <div className="mt-6 text-sm text-gray-600">
              <p>Le calcul inclut une marge de contingence de 20% sur le coÃ»t total de l'Ã©vÃ©nement. Les nouveaux membres bÃ©nÃ©ficient d'une rÃ©duction de 70% sur le coÃ»t calculÃ©.</p>
            </div>
          </div>

          {/* Submit button */}
          <div className="flex justify-end space-x-4">
            <button type="button" onClick={handleAddAttendee} className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">Ajouter un autre participant</button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Enregistrement en cours...' : 'Enregistrer l\'inscription'}</button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default RegistrationForm;



