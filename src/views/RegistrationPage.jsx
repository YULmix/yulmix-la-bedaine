import { Navigate, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import RegistrationForm from '../components/RegistrationForm';
import { Button, Notice, Skeleton } from '../components/ui';
import fr from '../locales/fr.json';
import { getEventPhase } from '../lib/eventPhase';
import { useMyRegistration } from '../hooks/useMyRegistration';

// /inscription: the registration flow on its own route, so the phone's back button leaves the
// form instead of the app, and the form gets the whole screen.
const RegistrationPage = ({ activeEvent, isAuthenticated }) => {
  const navigate = useNavigate();
  const { registration, loading, error } = useMyRegistration(activeEvent, isAuthenticated);

  if (!activeEvent) return <Navigate to="/" replace />;

  const isIntent = getEventPhase(activeEvent) === 'INTENT_PHASE';
  const title = registration ? fr.editRegistrationTitle : isIntent ? fr.intentFormTitle : fr.registrationFormTitle;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-data text-xs uppercase tracking-widest text-neon">{activeEvent.theme}</p>
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label={fr.cancel}>
          <X aria-hidden="true" className="size-5" />
        </Button>
      </div>

      {error && <Notice tone="bad" className="mb-6">{error}</Notice>}

      {loading ? (
        <div aria-busy="true" className="space-y-4">
          <span className="sr-only">{fr.loadingRegistrationMessage}</span>
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : (
        <RegistrationForm
          event={activeEvent}
          userRegistration={registration}
          isIntent={isIntent}
          onCancel={() => navigate('/')}
          onRegistrationSuccess={() => navigate('/', { state: { justSaved: true } })}
        />
      )}
    </main>
  );
};

export default RegistrationPage;
