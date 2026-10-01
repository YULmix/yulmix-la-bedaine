import { useMemo } from 'react';
import { Car, HandHeart, MessageSquareText, Music, Utensils } from 'lucide-react';
import fr from '../../locales/fr.json';
import { DIETARY_OPTIONS, VOLUNTEERING_OPTIONS, getOptionLabel, getTransportKindLabel } from '../../lib/registrationOptions';
import { dietaryBreakdown, partyComments, transportRows, volunteersByChoice } from '../../lib/adminStats';
import { formatDateTime } from '../../lib/format';
import { Card, EmptyState, Tag } from '../ui';

// The Logistique tab's read-only views of what parties answered in the form (#179). They list
// confirmed parties only (lib/adminStats.js); members change their answers by editing their
// registration.

const ViewHeader = ({ title, description }) => (
  <div>
    <h2 className="text-xl font-semibold text-ink">{title}</h2>
    <p className="mt-2 max-w-prose text-muted">{description}</p>
    <p className="mt-1 max-w-prose text-sm text-faint">{fr.logisticsConfirmedOnly}</p>
  </div>
);

const Count = ({ template, n }) => <Tag tone={n ? 'neon' : 'neutral'}>{template.replace('{n}', n)}</Tag>;

export const FoodView = ({ parties }) => {
  const needs = useMemo(() => dietaryBreakdown(parties), [parties]);
  return (
    <section className="space-y-4">
      <ViewHeader title={fr.logisticsViewFood} description={fr.foodViewDescription} />
      {needs.length === 0 ? <EmptyState icon={Utensils} title={fr.foodViewEmpty} /> : (
        <>
          <Card className="p-4 sm:p-5">
            <h3 className="sr-only">{fr.foodSummaryLabel}</h3>
            <ul aria-label={fr.foodSummaryLabel} className="flex flex-wrap gap-x-6 gap-y-2">
              {needs.map(({ need, attendees }) => (
                <li key={need} className="flex items-baseline gap-2">
                  <span className="font-data text-2xl text-ink">{attendees.length}</span>
                  <span className="text-muted">{getOptionLabel(DIETARY_OPTIONS, need)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {needs.map(({ need, attendees }) => (
              <li key={need}>
                <Card className="h-full p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-ink">{getOptionLabel(DIETARY_OPTIONS, need)}</h3>
                    <Count template={fr.logisticsPeopleCount} n={attendees.length} />
                  </div>
                  <ul className="space-y-2">
                    {attendees.map((attendee, index) => (
                      <li key={attendee.id || index} className="min-w-0">
                        <p className="text-ink [overflow-wrap:anywhere]">{attendee.name || fr.participantFallback}</p>
                        {attendee.other && <p className="whitespace-pre-line text-sm text-muted [overflow-wrap:anywhere]">{attendee.other}</p>}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export const VolunteeringView = ({ parties }) => {
  const choices = useMemo(() => volunteersByChoice(parties), [parties]);
  return (
    <section className="space-y-4">
      <ViewHeader title={fr.logisticsViewVolunteering} description={fr.volunteeringViewDescription} />
      <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {choices.map(({ choice, parties: volunteers }, index) => (
          <li key={choice}>
            <Card className={`h-full p-4 sm:p-5 ${volunteers.length ? '' : 'opacity-80'}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="font-semibold text-ink">
                  <span className="font-data text-faint">{`${index + 1}. `}</span>
                  {getOptionLabel(VOLUNTEERING_OPTIONS, choice)}
                </h3>
                <Count template={fr.logisticsPartiesCount} n={volunteers.length} />
              </div>
              {volunteers.length === 0 ? <p className="text-sm text-faint">{fr.volunteeringNobody}</p> : (
                <ul className="space-y-1.5">
                  {volunteers.map(volunteer => (
                    <li key={volunteer.id} className="min-w-0 [overflow-wrap:anywhere]">
                      <p className="text-ink">{volunteer.contact}</p>
                      {volunteer.other && <p className="whitespace-pre-line text-sm text-muted">{volunteer.other}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
};

const KIND_TONES = { offer: 'ok', need: 'warn' };

export const TransportView = ({ parties }) => {
  const rows = useMemo(() => transportRows(parties), [parties]);
  const orDash = value => value || fr.emptyValue;
  return (
    <section className="space-y-4">
      <ViewHeader title={fr.logisticsViewTransport} description={fr.transportViewDescription} />
      {rows.length === 0 ? <EmptyState icon={Car} title={fr.transportViewEmpty} /> : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => (
            <li key={row.id}>
              <Card className="h-full p-4 sm:p-5">
                <h3 className="mb-3 font-semibold text-ink [overflow-wrap:anywhere]">{row.contact}</h3>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
                  <dt className="text-faint">{fr.transportType}</dt>
                  <dd><Tag tone={KIND_TONES[row.kind]} className="px-2 py-0.5">{getTransportKindLabel(row.kind)}</Tag></dd>
                  <dt className="text-faint">{row.kind === 'offer' ? fr.transportSeatsOffered : fr.transportSeatsNeeded}</dt>
                  <dd className="text-ink">{row.seats}</dd>
                  <dt className="text-faint">{fr.transportArrival}</dt>
                  <dd className="text-ink">{orDash(formatDateTime(row.arrival))}</dd>
                  <dt className="text-faint">{fr.transportDeparture}</dt>
                  <dd className="text-ink">{orDash(formatDateTime(row.departure))}</dd>
                  <dt className="text-faint">{fr.transportDepartureFsa}</dt>
                  <dd className="font-data text-ink">{orDash(row.departureFsa)}</dd>
                  <dt className="text-faint">{fr.transportDeparturePlace}</dt>
                  <dd className="text-ink [overflow-wrap:anywhere]">{orDash(row.departurePlace)}</dd>
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const CommentList = ({ icon: Icon, title, items, empty }) => (
  <Card className="p-4 sm:p-5">
    <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink">
      <Icon aria-hidden="true" className="size-4.5 text-neon" strokeWidth={1.75} />
      {title}
      <Count template={fr.logisticsPartiesCount} n={items.length} />
    </h3>
    {items.length === 0 ? <p className="text-sm text-faint">{empty}</p> : (
      <ul aria-label={title} className="divide-y divide-line">
        {items.map(item => (
          <li key={item.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-semibold text-muted [overflow-wrap:anywhere]">{item.contact}</p>
            <p className="whitespace-pre-line text-ink [overflow-wrap:anywhere]">{item.text}</p>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const CommentsView = ({ parties }) => {
  const { music, messages } = useMemo(() => partyComments(parties), [parties]);
  return (
    <section className="space-y-4">
      <ViewHeader title={fr.logisticsViewComments} description={fr.commentsViewDescription} />
      <div className="grid gap-4 xl:grid-cols-2">
        <CommentList icon={Music} title={fr.musicRequests} items={music} empty={fr.commentsMusicEmpty} />
        <CommentList icon={MessageSquareText} title={fr.messageToOrganizers} items={messages} empty={fr.commentsMessagesEmpty} />
      </div>
    </section>
  );
};

export const FORM_VIEW_ICONS = { food: Utensils, volunteering: HandHeart, transport: Car, comments: MessageSquareText };
