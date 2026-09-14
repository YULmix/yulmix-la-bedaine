import { useState, useEffect } from 'react';
import Header from './components/Header';
import EventModal from './components/EventModal';
import fr from './locales/fr.json';
import { supabase } from './lib/supabase';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [otherEvents, setOtherEvents] = useState([]);

  useEffect(() => {
    fetchEvents();
    
    // Simulate auth check
    setTimeout(() => {
      setIsAuthenticated(false);
      setLoading(false);
    }, 500);
  }, []);

  const fetchEvents = async () => {
    try {
      // Fetch all events
      const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (events && events.length > 0) {
        // Find active event
        const active = events.find(event => event.is_active);
        const others = events.filter(event => !event.is_active);
        
        if (active) {
          setActiveEvent(active);
          setOtherEvents(others);
        } else {
          // If no active event, use the first one as active (demo)
          const firstEvent = events[0];
          setActiveEvent({ ...firstEvent, is_active: true });
          setOtherEvents(events.slice(1));
        }
      } else {
        // No events in database, use demo data
        const demoEvents = createDemoEvents();
        setActiveEvent(demoEvents.active);
        setOtherEvents(demoEvents.others);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des événements:', error);
      // Fallback to demo data
      const demoEvents = createDemoEvents();
      setActiveEvent(demoEvents.active);
      setOtherEvents(demoEvents.others);
    }
  };

  const createDemoEvents = () => {
    const activeEvent = {
      id: 'demo-active-event',
      theme: 'Weekend en montagne',
      description: 'Weekend de détente et activités en montagne avec tout le groupe. Un événement exceptionnel pour se retrouver entre amis et profiter de la nature.',
      venue_address: 'Chalet des Laurentides, QC',
      duration_days: 3,
      points_of_contact: 'Registration (Simon), Volunteering (Dave), Food/Special Activities (Melina / MC / Gary), Neighbors / Parking (Khaled), Pharma / First Aid / Bed Assignments (Mach)',
      z_intent_months: 2,
      x_reg_close_weeks: 1,
      reg_start_date: '2026-05-01',
      status: 'ACTIVE',
      is_active: true,
      is_reg_open: true,
      total_cost: 2500.00,
      cost_breakdown: [{ category: 'Chalet', amount: 1500 }, { category: 'Food', amount: 1000 }],
      selling_price_whole_event: 75.00,
      estimated_individual_cost_whole_event: 65.50,
      max_attendees: 90,
      external_links: [],
      instructions: 'Apportez vos vêtements chauds et votre bonne humeur. Le chalet fournit draps et couvertures.',
      created_at: new Date().toISOString()
    };

    const otherEvents = [
      {
        id: 'demo-event-1',
        theme: 'Soirée été',
        description: 'Soirée estivale avec barbecue et musique en plein air.',
        venue_address: 'Parc Lafontaine, Montréal, QC',
        duration_days: 1,
        status: 'ARCHIVED',
        is_active: false,
        is_reg_open: false,
        created_at: new Date(Date.now() - 86400000).toISOString()
      },
      {
        id: 'demo-event-2',
        theme: "Retraite d'hiver",
        description: "Retraite en montagne pour les skieurs et amateurs de sports d'hiver.",
        venue_address: 'Mont Tremblant, QC',
        duration_days: 2,
        status: 'DRAFT',
        is_active: false,
        is_reg_open: false,
        created_at: new Date(Date.now() - 172800000).toISOString()
      }
    ];

    return { active: activeEvent, others: otherEvents };
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setIsModalOpen(true);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusLabel = (status) => {
    const statusMap = {
      'DRAFT': 'Brouillon',
      'ACTIVE': 'En cours',
      'ARCHIVED': 'Archivé'
    };
    return statusMap[status] || status;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{fr.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />

      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-6">
            {fr.welcome}
          </h1>

          {/* Active Event Banner */}
          {activeEvent && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-600 rounded-lg shadow-lg p-6 mb-8">
              <div className="flex items-center mb-4">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-semibold rounded-full">
                  Événement actif
                </span>
                <span className="ml-auto px-3 py-1 bg-green-100 text-green-800 text-sm font-semibold rounded-full">
                  {activeEvent.is_reg_open ? 'Inscriptions ouvertes' : 'Inscriptions fermées'}
                </span>
              </div>
              
              <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-3">
                {activeEvent.theme}
              </h2>
              
              <p className="text-gray-600 mb-4">
                {activeEvent.description}
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <p className="text-sm text-gray-500">Lieu</p>
                  <p className="font-semibold">{activeEvent.venue_address}</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <p className="text-sm text-gray-500">Durée</p>
                  <p className="font-semibold">{activeEvent.duration_days} jours</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <p className="text-sm text-gray-500">Coût individuel estimé</p>
                  <p className="font-semibold">{formatCurrency(activeEvent.estimated_individual_cost_whole_event)}</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <p className="text-sm text-gray-500">Date d'ouverture des inscriptions</p>
                  <p className="font-semibold">{formatDate(activeEvent.reg_start_date)}</p>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-4">
                <button 
                  onClick={() => handleEventClick(activeEvent)}
                  className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Voir les détails complets
                </button>
                {activeEvent.is_reg_open && (
                  <button className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors">
                    S'inscrire maintenant
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* Other Events */}
          {otherEvents.length > 0 && (
            <>
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Autres événements</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {otherEvents.map((event) => (
                  <div 
                    key={event.id}
                    onClick={() => handleEventClick(event)}
                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow duration-300 cursor-pointer hover:transform hover:scale-[1.02]"
                  >
                    <div className="flex items-center mb-4">
                      <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
                        event.status === 'ARCHIVED' 
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {getStatusLabel(event.status)}
                      </span>
                    </div>
                    
                    <h3 className="text-xl font-semibold text-gray-800 mb-3">
                      {event.theme}
                    </h3>
                    
                    <p className="text-gray-600 mb-4">
                      {event.description}
                    </p>
                    
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500">Lieu: {event.venue_address}</span>
                      <button className="text-blue-600 hover:text-blue-800 font-medium">
                        {fr.viewDetails}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          
          {/* Empty State */}
          {otherEvents.length === 0 && (
            <div className="text-center py-12">
              <div className="inline-block p-4 bg-blue-50 rounded-full mb-4">
                <svg className="w-12 h-12 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">Aucun autre événement</h3>
              <p className="text-gray-500">Les événements précédents seront affichés ici.</p>
            </div>
          )}
          
          {!isAuthenticated && (
            <div className="mt-12 text-center">
              <p className="text-gray-600 mb-6">
                {fr.signIn} {fr.toViewEvents}
              </p>
            </div>
          )}
        </div>
      </main>
      
      <footer className="bg-gray-800 text-white py-6">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm">
            © {new Date().getFullYear()} {fr.appTitle}. {fr.allRightsReserved}
          </p>
          <div className="mt-4 flex justify-center space-x-6 text-sm">
            <a href="#" className="hover:text-gray-300">{fr.privacy}</a>
            <a href="#" className="hover:text-gray-300">{fr.terms}</a>
            <a href="#" className="hover:text-gray-300">{fr.help}</a>
            <a href="#" className="hover:text-gray-300">{fr.about}</a>
          </div>
        </div>
      </footer>

      {/* Event Modal */}
      <EventModal 
        event={selectedEvent}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

export default App;
