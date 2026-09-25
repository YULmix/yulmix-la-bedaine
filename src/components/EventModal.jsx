import { X } from 'lucide-react';
import fr from '../locales/fr.json';
import { getGoogleMapsUrl } from '../lib/venue';

const EventModal = ({ event, isOpen, onClose }) => {
  if (!isOpen) return null;

  // Map event data to expected format (supporting both old and new schema)
  const eventData = event ? {
    title: event.theme || event.title || "Événement sans titre",
    description: event.description || "Aucune description disponible.",
    venue: event.venue_address || event.venue || "Lieu non spécifié",
    address: event.venue_address || event.address || "",
    startDate: event.reg_start_date || event.startDate || "Date non spécifiée",
    endDate: event.reg_start_date && event.duration_days 
      ? new Date(new Date(event.reg_start_date).getTime() + event.duration_days * 86400000).toISOString().split('T')[0]
      : event.endDate || "Date non spécifiée",
    contactName: extractContactName(event.points_of_contact) || event.contactName || "Contact non spécifié",
    contactEmail: event.contactEmail || "",
    contactPhone: event.contactPhone || "",
    instructions: event.instructions || event.instructions || "Aucune instruction particulière.",
    // Additional fields for display
    duration_days: event.duration_days,
    points_of_contact: event.points_of_contact,
    total_cost: event.total_cost,
    selling_price_whole_event: event.selling_price_whole_event,
    estimated_individual_cost_whole_event: event.estimated_individual_cost_whole_event,
    max_attendees: event.max_attendees,
    status: event.status,
    is_reg_open: event.is_reg_open
  } : {
    title: "Événement exemple",
    description: "Description détaillée de l'événement.",
    venue: "Centre des congrès de Montréal",
    address: "1001 Place Jean-Paul-Riopelle, Montréal",
    startDate: "2024-06-15",
    endDate: "2024-06-17",
    contactName: "Jean Tremblay",
    contactEmail: "jean.tremblay@example.com",
    contactPhone: "(514) 123-4567",
    instructions: "Veuillez arriver 30 minutes avant le début."
  };

  // Helper to extract a contact name from points_of_contact string
  function extractContactName(points) {
    if (!points) return "";
    // Simple extraction: first name before comma
    const match = points.match(/^([^,]+)/);
    return match ? match[1].trim() : "";
  }

  const formatCurrency = (amount) => {
    if (!amount) return "";
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">{fr.eventDetails}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">{eventData.title}</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-lg font-semibold text-gray-800 mb-2">{fr.description}</h4>
              <p className="text-gray-700 mb-6">{eventData.description}</p>
              
              <h4 className="text-lg font-semibold text-gray-800 mb-2">{fr.instructions}</h4>
              <p className="text-gray-700">{eventData.instructions}</p>
              
              {/* Additional event info */}
              {eventData.duration_days && (
                <div className="mt-6">
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">Durée</h4>
                  <p className="text-gray-700">{eventData.duration_days} jour(s)</p>
                </div>
              )}
              
              {eventData.points_of_contact && (
                <div className="mt-6">
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">Points de contact</h4>
                  <p className="text-gray-700 whitespace-pre-line">{eventData.points_of_contact}</p>
                </div>
              )}
            </div>
            
            <div className="space-y-6">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-2">{fr.venue}</h4>
                <p className="text-gray-700">{eventData.venue}</p>
                {eventData.address && (
                  <a href={getGoogleMapsUrl(eventData.address)} target="_blank" rel="noopener noreferrer" className="text-gray-600 text-sm mt-1 underline hover:text-blue-600 transition-colors inline-block">
                    {eventData.address}
                  </a>
                )}
              </div>
              
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-2">{fr.dates}</h4>
                <p className="text-gray-700">
                  {formatDate(eventData.startDate)} - {formatDate(eventData.endDate)}
                </p>
              </div>
              
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-2">{fr.contact}</h4>
                <p className="text-gray-700">{eventData.contactName}</p>
                {eventData.contactEmail && <p className="text-gray-700">{eventData.contactEmail}</p>}
                {eventData.contactPhone && <p className="text-gray-700">{eventData.contactPhone}</p>}
              </div>
              
              {/* Financial info */}
              {eventData.estimated_individual_cost_whole_event && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">Coût individuel estimé</h4>
                  <p className="text-gray-700">{formatCurrency(eventData.estimated_individual_cost_whole_event)}</p>
                </div>
              )}
              
              {eventData.max_attendees && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">Capacité maximale</h4>
                  <p className="text-gray-700">{eventData.max_attendees} participants</p>
                </div>
              )}
              
              {eventData.status && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">Statut</h4>
                  <p className="text-gray-700">{getStatusLabel(eventData.status)}</p>
                </div>
              )}
              
              {eventData.is_reg_open !== undefined && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">Inscriptions</h4>
                  <p className={`px-3 py-1 rounded-full text-sm font-semibold ${eventData.is_reg_open ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {eventData.is_reg_open ? 'Inscriptions ouvertes' : 'Inscriptions fermées'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {fr.close}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EventModal;
