import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import EventModal from './components/EventModal';
import HomeView from './views/HomeView';
import AdminView from './views/AdminView';
import EventDetailsView from './views/EventDetailsView';
import fr from './locales/fr.json';
import { supabase } from './lib/supabase';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [otherEvents, setOtherEvents] = useState([]);
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);

  // Fetch admin status for current user (matches DB is_admin() function logic)
  const fetchAdminStatus = async (userId) => {
    try {
      // Use the database's is_admin() function which respects root email fallback
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('is_admin');
      
      if (!rpcError && typeof rpcData === 'boolean') {
        setIsAdmin(rpcData);
        return;
      }
      
      // Fallback: fetch profile and apply same logic client‑side
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin, email')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      // If profile doesn't exist yet (race condition after sign‑up), treat as non‑admin
      const isAdmin = data ? (data.is_admin || data.email === 'yulmixalabedaine@gmail.com') : false;
      setIsAdmin(isAdmin);
    } catch (error) {
      console.error('Error fetching admin status:', error);
      setIsAdmin(false);
    }
  };

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
    const now = new Date();
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
        theme: 'Retraite d\'hiver',
        description: 'Retraite en montagne pour les skieurs et amateurs de sports d\'hiver.',
        venue_address: 'Chalet du Mont, Val-Morin, QC',
        duration_days: 2,
        status: 'DRAFT',
        is_active: false,
        is_reg_open: false,
        created_at: new Date(Date.now() - 172800000).toISOString()
      }
    ];

    return { active: activeEvent, others: otherEvents };
  };
  // Protected Route component for admin access
  const ProtectedRoute = ({ children, adminOnly = false }) => {
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

    if (!isAuthenticated) {
      return <Navigate to="/" replace />;
    }

    if (adminOnly && !isAdmin) {
      return (
        <div className="container mx-auto px-4 py-8">
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
            <p>Accès réservé aux administrateurs.</p>
          </div>
        </div>
      );
    }

    return children;
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setIsModalOpen(true);
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

  useEffect(() => {
    fetchEvents();
    
    // Initialize auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event, session);
        setSession(session);
        setUser(session?.user || null);
        setIsAuthenticated(!!session);
        // Fetch admin status when authenticated
        if (session?.user) {
          await fetchAdminStatus(session.user.id);
        } else {
          setIsAdmin(false);
        }
        setLoading(false);
      }
    );

    // Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        
        console.log('Initial session:', session);
        setSession(session);
        setUser(session?.user || null);
        setIsAuthenticated(!!session);
        if (session?.user) {
          await fetchAdminStatus(session.user.id);
        }
      } catch (error) {
        console.error('Error getting initial session:', error);
        setIsAuthenticated(false);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
      <Header isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} user={user} isAdmin={isAdmin} />
      
      <Routes>
        <Route path="/" element={
          <main className="flex-grow container mx-auto px-4 py-8">
            <div className="max-w-6xl mx-auto">
              {isAuthenticated ? (
                <>
                  <HomeView activeEvent={activeEvent} isAuthenticated={isAuthenticated} />
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
              
                </>
              ) : (
                <div className="text-center py-16">
                  <div className="inline-block p-8 bg-blue-50 rounded-full mb-8">
                    <svg className="w-20 h-20 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-4">{fr.pleaseSignInHome}</h2>
                  <p className="text-gray-600 max-w-2xl mx-auto mb-8">
                    Utilisez le bouton "Se connecter" en haut à droite pour accéder aux événements.
                  </p>
                </div>
              )}
            </div>
          </main>
        } />
        
        <Route path="/event-details" element={
          <ProtectedRoute>
            <main className="flex-grow container mx-auto px-4 py-8">
              <div className="max-w-6xl mx-auto">
                <EventDetailsView activeEvent={activeEvent} />
              </div>
            </main>
          </ProtectedRoute>
        } />
        
        <Route path="/admin" element={
          <ProtectedRoute adminOnly={true}>
            <AdminView 
              activeEvent={activeEvent}
              otherEvents={otherEvents}
              isAdmin={isAdmin}
            />
          </ProtectedRoute>
        } />
      </Routes>
      
      <footer className="bg-gray-800 text-white py-6">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm">
            © {new Date().getFullYear()} {fr.org}. {fr.allRightsReserved}
          </p>
          <div className="mt-4 flex justify-center space-x-6 text-sm">
            <a href="https://docs.google.com/document/d/17bVJexViR12O4x62B9gizkM5bny5Ey1lStzJA_5u1Do/edit?usp=sharing" className="hover:text-gray-300">{fr.about}</a>
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
