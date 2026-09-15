import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import RegistrationForm from '../components/RegistrationForm';

const HomeView = ({ activeEvent, isAuthenticated }) => {
  const [userRegistration, setUserRegistration] = useState(null);
  const [loadingRegistration, setLoadingRegistration] = useState(false);
  const [error, setError] = useState(null);

  // Fetch user registration for the active event
  useEffect(() => {
    if (!isAuthenticated || !activeEvent?.id) {
      setUserRegistration(null);
      return;
    }

    const fetchUserRegistration = async () => {
      setLoadingRegistration(true);
      setError(null);
      
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) return;

        const { data: registration, error: regError } = await supabase
          .from('user_parties')
          .select('*')
          .eq('user_id', user.id)
          .eq('event_id', activeEvent.id)
          .maybeSingle();

        if (regError) throw regError;
        
        setUserRegistration(registration || null);
      } catch (err) {
        console.error('Erreur lors de la récupération de l\'inscription:', err);
        setError(err.message);
      } finally {
        setLoadingRegistration(false);
      }
    };

    fetchUserRegistration();
  }, [isAuthenticated, activeEvent]);

  // Determine event phase
  const getEventPhase = () => {
    if (!activeEvent) return 'NO_EVENT';
    
    const today = new Date();
    const regStartDate = new Date(activeEvent.reg_start_date);
    const intentMonths = activeEvent.z_intent_months || 2;
    
    // Calculate intent start date (reg_start_date - intentMonths months)
    const intentStartDate = new Date(regStartDate);
    intentStartDate.setMonth(intentStartDate.getMonth() - intentMonths);
    
    if (today >= intentStartDate && today < regStartDate) {
      return 'INTENT_PHASE';
    }
    
    if (activeEvent.status === 'ACTIVE' && activeEvent.is_reg_open) {
      return 'REGISTRATION_OPEN';
    }
    
    if (activeEvent.status === 'ACTIVE') {
      return 'ACTIVE_NO_REG';
    }
    
    return 'OTHER';
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

  const eventPhase = getEventPhase();
// If no active event
  if (!activeEvent) {
    return (
      <div className="text-center py-12">
        <div className="inline-block p-4 bg-gray-100 rounded-full mb-4">
          <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-700 mb-2">Aucun événement en cours</h3>
        <p className="text-gray-500">Aucun événement n'est actuellement actif. Revenez plus tard!</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Event header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-8 text-white">
        <h1 className="text-3xl font-bold mb-2">{activeEvent.theme}</h1>
        <p className="text-blue-100 mb-4">{activeEvent.description}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="bg-white/20 px-3 py-1 rounded-full">{formatDate(activeEvent.reg_start_date)}</div>
          <div className="bg-white/20 px-3 py-1 rounded-full">{activeEvent.venue_address}</div>
          <div className="bg-white/20 px-3 py-1 rounded-full">{activeEvent.duration_days} jour(s)</div>
        </div>
      </div>

      {/* Intent phase banner */}
      {eventPhase === 'INTENT_PHASE' && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong>Phase d'intention:</strong> Indiquez votre intention de participer et la composition de votre groupe pour aider à la planification.
              </p>
            </div>
          </div>
        </div>
      )}
{/* User registration status */}
      {isAuthenticated && userRegistration && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Votre inscription</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Statut</div>
              <div className={`text-lg font-semibold ${userRegistration.status === 'Enregistré' ? 'text-green-600' : 'text-yellow-600'}`}>
                {userRegistration.status}
              </div>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Liste d'attente</div>
              <div className={`text-lg font-semibold ${userRegistration.is_waitlisted ? 'text-red-600' : 'text-green-600'}`}>
                {userRegistration.is_waitlisted ? 'Oui' : 'Non'}
              </div>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Montant dû</div>
              <div className="text-2xl font-bold text-purple-600">
                {formatCurrency(userRegistration.calculated_amount_owed || 0)}
              </div>
            </div>
          </div>

          {/* Payment alert */}
          {userRegistration.payment_status === 'Impayé' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <svg className="h-5 w-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span className="text-red-700 font-medium">Envoyez votre virement Interac à: </span>
                <span className="text-red-900 font-bold ml-2">yulmixalabedaine@gmail.com</span>
              </div>
              <p className="text-red-600 text-sm mt-2">Veuillez inclure votre nom et le numéro d'événement dans la description du virement.</p>
            </div>
          )}

          {/* External links - Liste d'achats */}
          {activeEvent.external_links && activeEvent.external_links.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">Ressources de l'événement</h3>
              <div className="space-y-2">
                {activeEvent.external_links.map((link, index) => (
                  <a 
                    key={index} 
                    href={link.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                    {link.label || 'Lien de ressource'}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Registration form (show if user is authenticated and either not registered or in intent phase) */}
      {isAuthenticated && (!userRegistration || eventPhase === 'INTENT_PHASE') && (
        <RegistrationForm 
          event={activeEvent}
          userRegistration={userRegistration}
          onRegistrationSuccess={() => {
            // Refresh registration data
            if (activeEvent?.id) {
              window.location.reload();
            }
          }}
        />
      )}

      {/* Not authenticated message */}
      {!isAuthenticated && (
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="inline-block p-4 bg-blue-50 rounded-full mb-4">
            <svg className="w-12 h-12 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">Connectez-vous pour vous inscrire</h3>
          <p className="text-gray-500 mb-6">Vous devez être connecté pour voir les détails de l'événement et vous inscrire.</p>
          <button 
            onClick={() => {/* Auth handled by header */}}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Se connecter
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
};

export default HomeView;