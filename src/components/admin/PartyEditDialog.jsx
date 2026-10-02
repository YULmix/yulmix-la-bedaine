import fr from '../../locales/fr.json';
import RegistrationForm from '../RegistrationForm';
import PartyEmailLog from './PartyEmailLog';
import { Dialog } from '../ui';

// God-mode editing: the registration form, pre-filled with the party's exact attendees, saving as
// the admin for the member. `party` null is closed.
const PartyEditDialog = ({ party, event, onClose, onSaved }) => (
  <Dialog open={!!party} onClose={onClose} dismissible={false} size="lg" title={fr.adminEditRegistrationTitle}>
    {party && (
      <div className="px-4 pt-5 sm:px-6">
        <p className="mb-5 text-sm text-muted">{party.profiles?.full_name} <span className="text-faint">{party.profiles?.email}</span></p>
        <PartyEmailLog partyId={party.id} />
        <RegistrationForm
          event={event}
          userRegistration={party}
          adminMode={true}
          onAdminSave={onSaved}
          onCancel={onClose}
        />
      </div>
    )}
  </Dialog>
);

export default PartyEditDialog;
