import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarX2, Hourglass, Info, PartyPopper, RotateCw } from 'lucide-react';
import RegistrationSummary from './RegistrationSummary';
import PosterHeader from '../components/brand/PosterHeader';
import PhaseTrack from '../components/brand/PhaseTrack';
import { Button, Card, EmptyState, Notice, Skeleton } from '../components/ui';
import fr from '../locales/fr.json';
import { formatCurrency } from '../lib/format';
import { getEventPhase } from '../lib/eventPhase';
import { useMyRegistration } from '../hooks/useMyRegistration';
import { isActiveRegistration } from '../lib/registrationOptions';
import { useToasts } from '../hooks/useToasts';
import PastEditions from './PastEditions';

const linkButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-5 font-semibold transition duration-150 active:scale-[0.98]';
export const primaryLinkClass = `${linkButton} bg-neon text-night hover:brightness-110`;
export const secondaryLinkClass = `${linkButton} border border-edge text-ink hover:bg-raised`;

// Same footprint as the pass, so nothing jumps when the registration arrives.
const PassSkeleton = () => (
  <div aria-busy="true" className="grid gap-4 rounded-card border border-line bg-surface p-6 md:grid-cols-[1fr_18rem]">
    <span className="sr-only">{fr.loadingRegistrationMessage}</span>
    <div className="space-y-3">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-6 h-10 w-48" />
    </div>
    <div className="space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-36" />
      <Skeleton className="mt-6 h-11 w-full" />
    </div>
  </div>
);

const InviteCard = ({ event, isIntent }) => (
  <Card className="relative overflow-hidden p-6 sm:p-8 animate-rise">
    <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-xl">
        <PartyPopper aria-hidden="true" className="size-8 text-neon" strokeWidth={1.5} />
        <h2 className="mt-4 font-display text-display-md text-ink">{isIntent ? fr.inviteIntentTitle : fr.inviteTitle}</h2>
        <p className="mt-2 text-muted">{isIntent ? fr.intentPhaseMessage : fr.inviteText}</p>
        {event.selling_price_whole_event > 0 && (
          <p className="mt-4 text-sm text-muted">
            {fr.invitePriceLabel}{' '}
            <span className="font-data text-base text-ink">{formatCurrency(event.selling_price_whole_event)}</span>
          </p>
        )}
      </div>
      <Link to="/inscription" className={`${primaryLinkClass} md:shrink-0`}>
        {isIntent ? fr.declareIntentButton : fr.registerGroupButton}
        <ArrowRight aria-hidden="true" className="size-4.5" />
      </Link>
    </div>
  </Card>
);

// Long enough to read a sentence and reach for the close button (#155).
const TOAST_DURATION_MS = 7000;

const HomeView = ({ activeEvent, isAuthenticated, otherEvents = [], onEventClick }) => {
  const { registration, setRegistration, loading, error, refetch } = useMyRegistration(activeEvent, isAuthenticated);
  const { addToast } = useToasts(TOAST_DURATION_MS);
  const location = useLocation();
  const navigate = useNavigate();
  // Set by /inscription: 'created' after the confirmation screen, 'updated' straight after an edit.
  const savedKind = location.state?.justSaved;
  const justSaved = !!savedKind;
  const announcedSave = useRef(false);

  // Coming back from /inscription after a save: stamp the pass once, then clear the router state
  // so a refresh doesn't replay it. An edit is announced with a toast; a new registration already
  // was, by the confirmation screen it came from.
  useEffect(() => {
    if (!justSaved || announcedSave.current) return;
    announcedSave.current = true;
    if (savedKind === 'updated') addToast(fr.changesSavedToast, 'success');
    const timer = setTimeout(() => navigate('.', { replace: true, state: null }), 1200);
    return () => clearTimeout(timer);
  }, [justSaved]);

  if (!activeEvent) {
    return (
      <div className="space-y-10">
        <Card>
          <EmptyState icon={CalendarX2} title={fr.noActiveEventTitle}>{fr.noActiveEventMessage}</EmptyState>
        </Card>
        <PastEditions events={otherEvents} onEventClick={onEventClick} />
      </div>
    );
  }

  const eventPhase = getEventPhase(activeEvent);
  const isIntent = eventPhase === 'INTENT_PHASE';

  return (
    <div className="space-y-6">

      <PosterHeader event={activeEvent}>
        <Link to="/event-details" className={secondaryLinkClass}>
          <Info aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
          {fr.eventLearnMore}
        </Link>
      </PosterHeader>

      <Card className="px-5 py-5 sm:px-6">
        <PhaseTrack event={activeEvent} />
      </Card>

      {isIntent && (
        <Notice tone="warn" icon={Hourglass} title={fr.intentPhaseLabel.replace(/\s*:$/, '')}>
          {fr.intentPhaseMessage}
        </Notice>
      )}

      {error && (
        <Notice
          tone="bad"
          title={fr.registrationLoadError}
          action={<Button variant="secondary" size="sm" onClick={refetch}><RotateCw aria-hidden="true" className="size-4" />{fr.retry}</Button>}
        >
          {error}
        </Notice>
      )}

      {loading && !registration ? (
        <PassSkeleton />
      ) : isActiveRegistration(registration) ? (
        <RegistrationSummary
          registration={registration}
          event={activeEvent}
          isIntent={isIntent}
          animateStamp={justSaved}
          onEdit={() => navigate('/inscription')}
          onCancelled={(cancelled) => {
            setRegistration(cancelled);
            addToast(fr.cancelRegistrationSuccess, 'success');
          }}
          onError={(message) => addToast(message, 'error')}
        />
      ) : !error && (
        <>
          {registration && <Notice tone="info">{fr.registrationCancelledNotice}</Notice>}
          <InviteCard event={activeEvent} isIntent={isIntent} />
        </>
      )}

      <div className="pt-6">
        <PastEditions events={otherEvents} onEventClick={onEventClick} />
      </div>
    </div>
  );
};

export default HomeView;
