import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Car, Clock, LockKeyhole, Mail, MapPin } from 'lucide-react';
import fr from '../locales/fr.json';
import { supabase } from '../lib/supabase';
import { dbErrorMessage } from '../lib/dbErrors';
import { formatDateTime } from '../lib/format';
import { departureOf } from '../lib/registrationOptions';
import { carpoolSections } from '../lib/carpool';
import { Card, EmptyState, Notice, Skeleton, Tag } from '../components/ui';

const EDIT_TRANSPORT = '/inscription#transport';
const entryId = entry => `carpool-entry-${entry}`;
const notSpecified = value => value || fr.carpoolNotSpecified;
const km = value => String(Math.round(value));

// One match under an offer (a need near its route) or a need (an offer it's near): who, from
// where, the detour (or the distance, when the venue has no coordinates), and whether their times
// differ. The name jumps to that party's card.
const Match = ({ match }) => (
  <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
    <a href={`#${entryId(match.entry)}`} className="font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-neon [overflow-wrap:anywhere]">
      {match.contactName}
    </a>
    {match.departureFsa && <span className="font-data text-xs text-faint">{match.departureFsa}</span>}
    <span className="font-data text-xs text-neon">
      {match.detourKm != null
        ? fr.carpoolDetour.replace('{km}', km(match.detourKm))
        : fr.carpoolDistance.replace('{km}', km(match.distanceKm))}
    </span>
    {!match.timesLineUp && <Tag tone="warn" icon={Clock} className="px-2 py-0.5">{fr.carpoolTimesDiffer}</Tag>}
  </li>
);

const EntryCard = ({ entry }) => {
  const isOffer = entry.kind === 'offer';
  const departure = departureOf({ departure_fsa: entry.departure_fsa, departure_place: entry.departure_place });
  return (
    <Card as="article" id={entryId(entry.entry)} aria-labelledby={`${entryId(entry.entry)}-name`}
      className={`h-full scroll-mt-24 space-y-4 p-4 sm:p-5 ${entry.is_mine ? 'border-neon/60' : ''}`}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${entryId(entry.entry)}-name`} className="font-semibold text-ink [overflow-wrap:anywhere]">{entry.contact_name}</h3>
          {entry.is_mine && <Tag tone="neon" className="px-2 py-0.5">{fr.carpoolYou}</Tag>}
        </div>
        <a href={`mailto:${entry.contact_email}`} aria-label={fr.carpoolEmailLabel.replace('{name}', entry.contact_name)}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-neon underline underline-offset-4 [overflow-wrap:anywhere]">
          <Mail aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />{entry.contact_email}
        </a>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm">
        <dt className="text-faint">{fr.transportDeparturePlaceShort}</dt>
        <dd className="text-ink [overflow-wrap:anywhere]">{notSpecified(departure)}</dd>
        <dt className="text-faint">{fr.transportArrival}</dt>
        <dd className="text-ink">{notSpecified(formatDateTime(entry.arrival))}</dd>
        <dt className="text-faint">{fr.transportDeparture}</dt>
        <dd className="text-ink">{notSpecified(formatDateTime(entry.departure))}</dd>
        <dt className="text-faint">{isOffer ? fr.transportSeatsOffered : fr.transportSeatsNeeded}</dt>
        <dd className="font-data text-ink">{entry.seats || fr.carpoolNotSpecified}</dd>
      </dl>
      <div className="space-y-2 border-t border-line pt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-faint">{isOffer ? fr.carpoolClosestNeeds : fr.carpoolClosestOffers}</h4>
        {entry.matches.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {entry.matches.map(match => <Match key={match.entry} match={match} />)}
          </ul>
        ) : (
          <p className="text-sm text-muted">{entry.departure_fsa ? fr.carpoolNoMatches : fr.carpoolNoFsa}</p>
        )}
      </div>
    </Card>
  );
};

const Section = ({ title, entries, empty, icon }) => (
  <section className="space-y-3" aria-label={title}>
    <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
      {title}
      <span className="font-data text-sm text-faint">{entries.length}</span>
    </h2>
    {entries.length === 0 ? (
      <Card><EmptyState icon={icon} title={empty} /></Card>
    ) : (
      <ul className="grid gap-4 md:grid-cols-2">
        {entries.map(entry => <li key={entry.entry}><EntryCard entry={entry} /></li>)}
      </ul>
    )}
  </section>
);

// /carpool (#180): the lifts offered and needed by the parties of the active event that agreed to
// be listed, each with its closest matches. Who may see it, who is on it and the detours are the
// database's (carpool_board()); anyone else gets its error, shown as « not available ».
const CarpoolView = () => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    supabase.rpc('carpool_board').then(({ data, error: loadError }) => {
      if (ignore) return;
      if (loadError) {
        console.error('Error loading the carpool board:', loadError);
        setError(loadError);
        return setRows([]);
      }
      setRows(data || []);
    });
    return () => { ignore = true; };
  }, []);

  const { offers, needs, mine } = useMemo(() => carpoolSections(rows), [rows]);

  if (error?.message === 'carpool_board_forbidden') {
    return (
      <EmptyState icon={LockKeyhole} title={dbErrorMessage(error, fr.carpoolLoadError)}
        action={<Link to="/" className="font-semibold text-neon underline underline-offset-4">{fr.backToHome}</Link>} />
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-3 font-display text-display-md text-ink">
          <Car aria-hidden="true" className="size-7 text-neon" strokeWidth={1.75} />{fr.carpoolTitle}
        </h1>
        <p className="max-w-prose text-muted">{fr.carpoolIntro}</p>
      </header>

      {error && <Notice tone="bad">{dbErrorMessage(error, fr.carpoolLoadError)}</Notice>}

      {rows && (mine && !mine.departure_fsa ? (
        <Notice tone="warn" icon={MapPin}
          action={<Link to={EDIT_TRANSPORT} className="shrink-0 self-center text-sm font-semibold text-neon underline underline-offset-4">{fr.carpoolAddFsa}</Link>}>
          {fr.carpoolAddFsaHint}
        </Notice>
      ) : !mine && (
        <Notice tone="info"
          action={<Link to={EDIT_TRANSPORT} className="shrink-0 self-center text-sm font-semibold text-neon underline underline-offset-4">{fr.carpoolEditTransport}</Link>}>
          {fr.carpoolHowToBeListed}
        </Notice>
      ))}

      {!rows ? (
        <div aria-busy="true" className="grid gap-4 md:grid-cols-2">
          <span className="sr-only">{fr.loading}</span>
          <Skeleton className="h-64 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : (
        <>
          <Section title={fr.carpoolOffersTitle} entries={offers} empty={fr.carpoolOffersEmpty} icon={Car} />
          <Section title={fr.carpoolNeedsTitle} entries={needs} empty={fr.carpoolNeedsEmpty} icon={MapPin} />
        </>
      )}
    </div>
  );
};

export default CarpoolView;
