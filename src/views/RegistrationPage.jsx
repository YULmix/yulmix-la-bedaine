import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import RegistrationForm from '../components/RegistrationForm';
import RegistrationConfirmation from '../components/RegistrationConfirmation';
import { Button, Notice, Skeleton } from '../components/ui';
import fr from '../locales/fr.json';
import { getEventPhase } from '../lib/eventPhase';
import { useMyRegistration } from '../hooks/useMyRegistration';
import { isActiveRegistration } from '../lib/registrationOptions';
import { CANVAS_CLASS, pageWidthClass } from '../lib/pageWidth';
import { draftStorageKey } from '../lib/registrationDraft';

// /inscription: the registration flow on its own route, so the phone's back button leaves the
// form instead of the app, and the form gets the whole screen.
const RegistrationPage = ({ activeEvent, isAuthenticated, userId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { registration: row, loading, error } = useMyRegistration(activeEvent, isAuthenticated);
  // The party a new registration just saved: the page then confirms it instead of the form (#155).
  const [savedParty, setSavedParty] = useState(null);
  // Registering again after cancelling starts a fresh form; the save reuses the cancelled row.
  const registration = isActiveRegistration(row) ? row : null;

  if (!activeEvent) return <Navigate to="/" replace />;

  // /inscription#transport (from the carpool board, #180) opens an existing registration on its
  // transport card.
  const initialStep = registration && location.hash === '#transport' ? 2 : 0;
  const isIntent = getEventPhase(activeEvent) === 'INTENT_PHASE';
  const title = registration ? fr.editRegistrationTitle : isIntent ? fr.intentFormTitle : fr.registrationFormTitle;
  const showPass = () => navigate('/', { state: { justSaved: 'created' } });
  // A new registration gets a confirmation to read; an edit goes straight back to its pass, which
  // announces the change with a toast.
  const handleSaved = (party) => {
    if (registration) navigate('/', { state: { justSaved: 'updated' } });
    else setSavedParty(party);
  };

  return (
    <main className={`${CANVAS_CLASS} flex-1 pt-4 md:pt-8`}>
      <div className={`mx-auto ${pageWidthClass('narrow')}`}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-data text-xs uppercase tracking-widest text-neon">{activeEvent.theme}</p>
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={savedParty ? showPass : () => navigate('/')} aria-label={savedParty ? fr.close : fr.cancel}>
          <X aria-hidden="true" className="size-5" />
        </Button>
      </div>

      {error && !savedParty && <Notice tone="bad" className="mb-6">{error}</Notice>}

      {savedParty ? (
        <RegistrationConfirmation registration={savedParty} event={activeEvent} isIntent={isIntent} onContinue={showPass} />
      ) : loading ? (
        <div aria-busy="true" className="space-y-4">
          <span className="sr-only">{fr.loadingRegistrationMessage}</span>
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : (
        <RegistrationForm
          // Remounts once the member is known, so a draft left in this tab is picked up.
          key={userId || 'anonymous'}
          event={activeEvent}
          userRegistration={registration}
          isIntent={isIntent}
          onCancel={() => navigate('/')}
          onRegistrationSuccess={handleSaved}
          draftKey={userId ? draftStorageKey(userId, activeEvent.id) : null}
          initialStep={initialStep}
        />
      )}
      </div>
    </main>
  );
};

export default RegistrationPage;
