import { useNavigate } from 'react-router-dom';
import fr from '../locales/fr.json';
import { getGoogleMapsUrl } from '../lib/venue';

const EventDetailsView = ({ activeEvent }) => {
  const navigate = useNavigate();

  // Format date in French Canadian
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

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

  // Ensure external_links is an array
  const externalLinks = activeEvent.external_links || [];

  return (
    <div className="space-y-8">
      {/* Event header (identical to HomeView) */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-8 text-white">
        <h1 className="text-3xl font-bold mb-2">{activeEvent.theme}</h1>
        <p className="text-blue-100 mb-4">{activeEvent.description}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="bg-white/20 px-3 py-1 rounded-full">{formatDate(activeEvent.reg_start_date)}</div>
          {activeEvent.venue_address && (
            <a href={getGoogleMapsUrl(activeEvent.venue_address)} target="_blank" rel="noopener noreferrer" className="bg-white/20 px-3 py-1 rounded-full underline hover:bg-white/30 transition-colors">
              {activeEvent.venue_address}
            </a>
          )}
          <div className="bg-white/20 px-3 py-1 rounded-full">{activeEvent.duration_days} jour(s)</div>
        </div>
      </div>

      {/* Back to registration button */}
      <div className="flex justify-end">
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          {fr.backToRegistration}
        </button>
      </div>

      {/* Details panel */}
      <div className="bg-white rounded-xl shadow-lg p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Détails de l'événement</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left column */}
          <div className="space-y-6">
            {/* Points de Contact */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">{fr.eventPointsOfContactLabel}</h3>
              <p className="text-gray-800 whitespace-pre-line">{activeEvent.points_of_contact || 'Non spécifié'}</p>
            </div>

            {/* Instructions */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">{fr.eventInstructionsLabel}</h3>
              <p className="text-gray-800 whitespace-pre-line">{activeEvent.instructions || 'Aucune instruction particulière.'}</p>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Date de début des inscriptions */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">{fr.eventRegStartDateLabel}</h3>
              <p className="text-gray-800">{formatDate(activeEvent.reg_start_date)}</p>
            </div>

            {/* Délai d'intention avant inscription (mois) */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">{fr.eventIntentMonthsLabel}</h3>
              <p className="text-gray-800">{activeEvent.z_intent_months || 2} mois</p>
            </div>

            {/* Fermeture des inscriptions avant l'événement (semaines) */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">{fr.eventRegCloseWeeksLabel}</h3>
              <p className="text-gray-800">{activeEvent.x_reg_close_weeks || 1} semaine(s)</p>
            </div>

            {/* Liens Externes */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">{fr.eventExternalLinksLabel}</h3>
              {externalLinks.length > 0 ? (
                <ul className="space-y-2">
                  {externalLinks.map((link, index) => (
                    <li key={index}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {link.label || link.url}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-600">{fr.eventNoExternalLinks}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventDetailsView;