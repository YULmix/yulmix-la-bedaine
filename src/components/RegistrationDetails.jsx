import { BedDouble, Car, HandHeart, Music, MessageSquareText, Utensils } from 'lucide-react';
import fr from '../locales/fr.json';
import { formatDateTime } from '../lib/format';
import { initials } from '../lib/eventDisplay';
import { Tag, cx } from './ui';
import { ACCOMMODATION_ICONS, DIETARY_ICONS } from './accommodationIcons';
import {
  ACCOMMODATION_OPTIONS,
  DIETARY_OPTIONS,
  dietaryNeedsOf,
  departureOf,
  VOLUNTEERING_OPTIONS,
  getOptionLabel,
  getTransportTypeLabel,
  transportKindOf,
  getAttendeeTypeLabel,
  getParticipationSummaryLabel
} from '../lib/registrationOptions';

// The building blocks of a registration's read-only recap, shared by the member's own summary and
// the admin's « Inscription » dialog: what the party told us, with raw values mapped through
// registrationOptions.

export const InfoBlock = ({ icon: Icon, title, children }) => (
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

// Each attendee: type, participation, first-time flag, sleeping preference, diet, and the place
// once one is assigned.
export const AttendeeList = ({ attendees, className }) => (
  <ul className={cx('divide-y divide-line', className)}>
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
              <Tag icon={ACCOMMODATION_ICONS[attendee.sleeping_preference] || BedDouble}>
                {getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference)}
                {attendee.sleeping_preference === 'outside_other' && attendee.sleeping_preference_other ? `: ${attendee.sleeping_preference_other}` : ''}
              </Tag>
            )}
            {dietaryNeedsOf(attendee.dietary_needs).filter(value => value !== 'none').map(value => (
              <Tag key={value} icon={DIETARY_ICONS[value] || Utensils}>
                {value === 'other' && attendee.dietary_other ? attendee.dietary_other : getOptionLabel(DIETARY_OPTIONS, value)}
              </Tag>
            ))}
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
);

// Transport, volunteering, music requests and the message to the organisers.
export const RegistrationInputs = ({ registration }) => {
  const logistics = registration.logistics || {};
  const transport = registration.transport || {};
  const transportKind = transportKindOf(transport);
  const volunteering = logistics.volunteering || [];
  return (
    <>
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
    </>
  );
};
