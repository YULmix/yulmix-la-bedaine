import { useState, useEffect } from 'react';
import { ArrowRight, BedDouble, Car, HandHeart, History, LogOut, Music, MessageSquareText, Pencil, Utensils } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cancelParty } from '../lib/parties';
import { fetchLocationGalleries } from '../lib/galleries';
import { sleepingByLocation } from '../lib/places';
import fr from '../locales/fr.json';
import { formatDate, formatDateTime } from '../lib/format';
import { getRegistrationCloseDate, isRegistrationLocked } from '../lib/eventPhase';
import { describeChanges } from '../lib/editHistory';
import { initials } from '../lib/eventDisplay';
import Pass from '../components/brand/Pass';
import MyPartyEmails from '../components/MyPartyEmails';
import GalleryButton from '../components/Gallery';
import { Button, Card, ConfirmDialog, Tag } from '../components/ui';
import {
  ACCOMMODATION_OPTIONS,
  dietaryLabelsOf,
  departureOf,
  VOLUNTEERING_OPTIONS,
  getOptionLabel,
  getTransportTypeLabel,
  transportKindOf,
  EDITABLE_REGISTRATION_STATUSES,
  getAttendeeTypeLabel,
  getParticipationSummaryLabel
} from '../lib/registrationOptions';

const InfoBlock = ({ icon: Icon, title, children }) => (
  <div className="flex gap-3">
    <span className="grid size-10 shrink-0 place-items-center rounded-control bg-raised text-neon">
      <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
    </span>
    <div className="min-w-0 flex-1">
      <h4 className="text-sm font-semibold text-muted">{title}</h4>
      <div className="mt-1 text-ink">{children}</div>
    </div>
  </div>
);

// Home page, registered state: the pass (signature), then the group, logistics, requests and edit
// history. What matters most (am I in, what do I owe) is on the pass; details follow.
const RegistrationSummary = ({ registration, event, isIntent, animateStamp, onEdit, onCancelled, onError }) => {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editHistory, setEditHistory] = useState([]);
  const [locationGalleries, setLocationGalleries] = useState(new Map());

  // Keyed on the party id only: a new `registration` object (a refresh, realtime) must not refetch.
  const registrationId = registration?.id;
  useEffect(() => {
    if (!registrationId) return undefined;
    let stale = false;
    const loadEditHistory = async () => {
      try {
        const { data, error } = await supabase
          .from('registration_edits')
          .select('*')
          .eq('registration_id', registrationId)
          .order('edited_at', { ascending: false });
        if (error) throw error;
        if (!stale) setEditHistory(data || []);
      } catch (err) {
        if (!stale) console.error("Erreur lors du chargement de l'historique des modifications:", err);
      }
    };
    loadEditHistory();
    return () => { stale = true; };
  }, [registrationId]);

  // Cancelling is a soft status change (#35): the row stays, the waitlist is promoted by the
  // database, and after the close date the database refuses it (the button is hidden by then).
  const handleCancel = async () => {
    setCancelling(true);
    try {
      const cancelled = await cancelParty(supabase, registration.id);
      setConfirmingCancel(false);
      onCancelled?.(cancelled);
    } catch (err) {
      setConfirmingCancel(false);
      onError?.(err.message);
    } finally {
      setCancelling(false);
    }
  };

  const attendees = registration.attendees || [];
  const sleeping = sleepingByLocation(attendees);
  const sleepingKey = sleeping.map(location => location.locationId).join(',');

  // The galleries of the locations the party sleeps in (#177); none is just no photos.
  useEffect(() => {
    let current = true;
    fetchLocationGalleries(sleepingKey ? sleepingKey.split(',') : [])
      .then(galleries => { if (current) setLocationGalleries(galleries); })
      .catch(loadError => console.error('Error loading location galleries:', loadError));
    return () => { current = false; };
  }, [sleepingKey]);
  // What the organisers wrote to the party (#216); their private admin_notes never show here.
  const organizersMessage = registration.message_to_participants?.trim();
  const logistics = registration.logistics || {};
  const transport = registration.transport || {};
  const transportKind = transportKindOf(transport);
  const volunteering = logistics.volunteering || [];
  const isCancellable = EDITABLE_REGISTRATION_STATUSES.includes(registration.status);
  const locked = isRegistrationLocked(event);

  return (
    <div className="space-y-6">
      <Pass
        registration={registration}
        event={event}
        isIntent={isIntent}
        animateStamp={animateStamp}
        action={(
          <Button onClick={onEdit} className="w-full">
            <Pencil aria-hidden="true" className="size-4.5" strokeWidth={2} />
            {fr.editRegistration}
          </Button>
        )}
      />

      <MyPartyEmails registration={registration} />

      {/* min-w-0 columns: a long unbroken text (a pasted link) wraps instead of widening them. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="min-w-0 p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-ink">{fr.attendeesList}</h3>
          <ul className="mt-4 divide-y divide-line">
            {attendees.map((attendee, index) => (
              <li key={index} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-raised font-data text-sm text-muted">
                  {initials(attendee.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{attendee.name}</p>
                  <p className="text-sm text-muted">
                    {getAttendeeTypeLabel(attendee.type)}
                    {attendee.type !== 'Kid' && `, ${getParticipationSummaryLabel(attendee.participation).toLowerCase()}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attendee.is_new_member && <Tag tone="neon">{fr.firstTimeTag}</Tag>}
                    {attendee.sleeping_preference && (
                      <Tag icon={BedDouble}>
                        {getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference)}
                        {attendee.sleeping_preference === 'outside_other' && attendee.sleeping_preference_other ? `: ${attendee.sleeping_preference_other}` : ''}
                      </Tag>
                    )}
                    {dietaryLabelsOf(attendee).map(label => <Tag key={label} icon={Utensils}>{label}</Tag>)}
                  </div>
                  {attendee.place && (
                    <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 rounded-control tint-ok px-2.5 py-1 text-sm text-ok">
                      <BedDouble aria-hidden="true" className="size-4" />
                      {fr.confirmedAssignmentLabel} <span className="font-data">{attendee.place.bed_label}</span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="min-w-0 space-y-6">
          {/* What the party told us in the form; Logistique is what the organisers decided, so it
              only shows once there is something (a place, or their message). */}
          <Card className="space-y-5 p-5 sm:p-6">
            <h3 className="text-lg font-semibold text-ink">{fr.inputSummary}</h3>
            <InfoBlock icon={Car} title={fr.transport}>
              <p>
                {getTransportTypeLabel(transport)}
                {transportKind !== 'none' && transport.seats > 0 && `, ${fr.transportSeatsShort.replace('{count}', transport.seats)}`}
              </p>
              {transportKind !== 'none' && (transport.arrival || transport.departure || departureOf(transport)) && (
                <p className="mt-1 text-sm text-muted">
                  {transport.arrival && <span className="block">{fr.transportArrivalLabel} {formatDateTime(transport.arrival)}</span>}
                  {transport.departure && <span className="block">{fr.transportDepartureLabel} {formatDateTime(transport.departure)}</span>}
                  {departureOf(transport) && <span className="block [overflow-wrap:anywhere]">{fr.transportDeparturePlaceLabel} {departureOf(transport)}</span>}
                </p>
              )}
            </InfoBlock>
            <InfoBlock icon={HandHeart} title={fr.volunteering}>
              {volunteering.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {volunteering.map(item => (
                    <Tag key={item}>{item === 'other' && logistics.volunteering_other ? logistics.volunteering_other : getOptionLabel(VOLUNTEERING_OPTIONS, item, item)}</Tag>
                  ))}
                </div>
              ) : <p className="text-muted">{fr.noVolunteeringSelectedMessage}</p>}
            </InfoBlock>
            {registration.music_requests && (
              <InfoBlock icon={Music} title={fr.musicRequests}>
                <p className="whitespace-pre-line [overflow-wrap:anywhere]">{registration.music_requests}</p>
              </InfoBlock>
            )}
            {registration.message_to_organizers && (
              <InfoBlock icon={MessageSquareText} title={fr.messageToOrganizers}>
                <p className="whitespace-pre-line [overflow-wrap:anywhere]">{registration.message_to_organizers}</p>
              </InfoBlock>
            )}
          </Card>
          {(sleeping.length > 0 || organizersMessage) && (
            <Card className="space-y-5 p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-ink">{fr.logisticsSummary}</h3>
              {sleeping.length > 0 && (
                <InfoBlock icon={BedDouble} title={fr.sleepingSummaryTitle}>
                  <ul className="space-y-3">
                    {sleeping.map(location => (
                      <li key={location.locationId} className="flex items-start gap-3">
                        <GalleryButton images={locationGalleries.get(location.locationId)} name={location.name} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold">{location.name}</p>
                          <p className="text-sm text-muted">
                            {location.sleepers.map(sleeper => `${sleeper.name} · ${sleeper.place}`).join(', ')}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </InfoBlock>
              )}
              {organizersMessage && (
                <InfoBlock icon={MessageSquareText} title={fr.messageFromOrganizers}>
                  <p className="whitespace-pre-line [overflow-wrap:anywhere]">{organizersMessage}</p>
                </InfoBlock>
              )}
            </Card>
          )}
        </div>
      </div>

      <Card as="details" className="group p-5 sm:p-6">
        <summary className="flex min-h-11 items-center justify-between gap-4">
          <span className="flex items-center gap-3">
            <History aria-hidden="true" className="size-5 text-faint" strokeWidth={1.75} />
            <span className="font-semibold text-ink">{fr.editHistoryTitle}</span>
          </span>
          <span className="text-sm text-muted">
            {registration.last_edited_at
              ? fr.lastEditedOn.replace('{date}', formatDateTime(registration.last_edited_at))
              : fr.neverEditedMessage}
            <ArrowRight aria-hidden="true" className="ml-2 inline size-4 transition group-open:rotate-90" />
          </span>
        </summary>
        {editHistory.length > 0 ? (
          <ol className="mt-4 space-y-4 border-l border-line pl-5">
            {editHistory.map(edit => {
              const lines = describeChanges(edit.changes);
              return (
                <li key={edit.id} className="relative">
                  <span aria-hidden="true" className="absolute -left-[1.625rem] top-1.5 size-2.5 rounded-full bg-edge" />
                  <p className="font-data text-xs text-faint">{formatDateTime(edit.edited_at)}</p>
                  {lines.length > 0 ? (
                    <ul className="mt-1 space-y-1 text-sm">
                      {lines.map((line, index) => (
                        <li key={index} className="text-muted">
                          <span className="font-semibold text-ink">{line.label}</span>{' '}
                          {line.from && (
                            <>
                              <span className="break-words">{line.from}</span>
                              <ArrowRight aria-label={fr.historyChangedTo} className="mx-1 inline size-3.5 text-faint" />
                            </>
                          )}
                          <span className="break-words text-ink">{line.to}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-1 text-sm text-muted">{fr.historyNoDetail}</p>}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-muted">{fr.neverEditedMessage}</p>
        )}
      </Card>

      {isCancellable && !locked && (
        <div className="flex justify-center pt-2">
          <Button variant="dangerGhost" onClick={() => setConfirmingCancel(true)}>
            <LogOut aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
            {fr.cancelRegistration}
          </Button>
        </div>
      )}
      {isCancellable && locked && (
        <p className="pt-2 text-center text-sm text-muted">
          {fr.cancelRegistrationLocked.replace('{date}', formatDate(getRegistrationCloseDate(event)))}
        </p>
      )}

      <ConfirmDialog
        open={confirmingCancel}
        title={fr.cancelRegistrationConfirmTitle}
        confirmLabel={fr.cancelRegistration}
        onConfirm={handleCancel}
        onCancel={() => setConfirmingCancel(false)}
        loading={cancelling}
      >
        {fr.cancelRegistrationConfirm}
      </ConfirmDialog>
    </div>
  );
};

export default RegistrationSummary;
