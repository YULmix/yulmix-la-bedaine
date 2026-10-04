import { useEffect, useState } from 'react';
import { ChevronDown, History, Search, UserMinus, UsersRound } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { supabase } from '../../../lib/supabase';
import { refreshEvents, useEvents } from '../../../lib/events';
import { ACCESS_ROLE_OPTIONS, EDITION_ROLE_OPTIONS, getAccessRoleLabel, getEditionRoleLabel } from '../../../lib/registrationOptions';
import { currentUserId as fetchCurrentUserId, setIsAdmin } from '../../../lib/profiles';
import {
  isRootAdmin, levelOf, listAdminRoleLog, listAdmins, listEditionRoleLog, listEditionTeam, listPeople,
  matchesPerson, mergeTeamLog, personLabel, searchPeople, setEditionRole
} from '../../../lib/team';
import { formatHistoryTimestamp } from '../../../lib/changeHistory';
import { useToasts } from '../../../hooks/useToasts';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Notice, Select, Skeleton, Tag, Toggle } from '../../ui';
import { EVENT_STATUS } from '../AdminEvents';
import SectionStatus from './SectionStatus';

// « Équipe » (#217, #257, ADR 0023): where access is managed. The admins (every edition), then for
// one edition the people with a role (Comité, Organisateur); a picker listing accounts with their
// level (the edition's registrants by default) to give Comité, Organisateur or Admin, changing or
// removing them; and the log of every change, admin ones merged in. Admin-only (the section
// registry and the database both say so; the database refuses one's own and the root admin's).

const SEARCH_DELAY_MS = 250;

// What each role may do, one line each (ADR 0023). Closed until opened: it is reference, not news.
const RolesHelp = () => (
  <details className="group rounded-card border border-line bg-surface">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold text-ink sm:px-6">
      {fr.teamHelpTitle}
      <ChevronDown aria-hidden="true" className="size-4.5 text-faint transition group-open:rotate-180" />
    </summary>
    <div className="space-y-3 px-5 pb-5 text-muted sm:px-6">
      <p>{fr.teamHelpLead}</p>
      <dl className="space-y-3">
        {[['admin', 'info', 'teamHelpAdmin'], ['organiser', 'ok', 'teamHelpOrganiser'], ['committee', 'neutral', 'teamHelpCommittee']].map(([role, tone, key]) => (
          <div key={role} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="sm:w-32 sm:shrink-0"><Tag tone={tone}>{getAccessRoleLabel(role)}</Tag></dt>
            <dd>{fr[key]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-faint">{fr.teamHelpScope}</p>
    </div>
  </details>
);

// The level tag: Admin, the role on the edition, or nothing.
const LevelTag = ({ level }) => level && <Tag tone={level === 'admin' ? 'info' : level === 'organiser' ? 'ok' : 'neutral'}>{getAccessRoleLabel(level)}</Tag>;

const eventOption = (event) => fr.changeHistoryEventOption
  .replace('{theme}', event.theme || fr.historyEmptyValue)
  .replace('{status}', fr[(event.is_active ? EVENT_STATUS.ACTIVE : EVENT_STATUS[event.status] || EVENT_STATUS.DRAFT).key]);

const RoleSelect = ({ value, onChange, options = EDITION_ROLE_OPTIONS, ...props }) => (
  <Select value={value} onChange={e => onChange(e.target.value)} {...props}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </Select>
);

const logLine = (entry) => {
  const actor = entry.actor ? personLabel(entry.actor) : fr.historySystemAuthor;
  const person = personLabel(entry.person);
  if (entry.kind === 'admin') {
    return (entry.granted ? fr.teamLogAdminGranted : fr.teamLogAdminRemoved).replace('{actor}', actor).replace('{person}', person);
  }
  if (!entry.oldRole) {
    return fr.teamLogGranted.replace('{actor}', actor).replace('{role}', getEditionRoleLabel(entry.newRole)).replace('{person}', person);
  }
  if (!entry.newRole) {
    return fr.teamLogRemoved.replace('{actor}', actor).replace('{role}', getEditionRoleLabel(entry.oldRole)).replace('{person}', person);
  }
  return fr.teamLogChanged.replace('{actor}', actor).replace('{person}', person)
    .replace('{old}', getEditionRoleLabel(entry.oldRole)).replace('{new}', getEditionRoleLabel(entry.newRole));
};

const ListSkeleton = () => (
  <div aria-busy="true" className="mt-4 space-y-3">
    <span className="sr-only">{fr.loading}</span>
    <Skeleton className="h-12 rounded-control" />
    <Skeleton className="h-12 rounded-control" />
  </div>
);

// The accounts with their level, listed before anything is typed (the edition's registrants unless
// the filter is off), narrowed as the admin types, to give the chosen role to one. Past the cap
// the whole list isn't loaded: the admin types and the server searches.
const AddPerson = ({ team, eventId, reloads, onAdd, busyId }) => {
  const [role, setRole] = useState(EDITION_ROLE_OPTIONS[0].value);
  const [query, setQuery] = useState('');
  const [registeredOnly, setRegisteredOnly] = useState(true);
  const [listing, setListing] = useState({ key: '', people: [], capped: false, error: null });
  const [results, setResults] = useState({ key: '', people: [], error: null });
  const key = `${eventId}|${registeredOnly}|${reloads}`;

  useEffect(() => {
    let current = true;
    listPeople(supabase, eventId, { registeredOnly })
      .then(({ people, capped }) => { if (current) setListing({ key, people, capped, error: null }); })
      .catch(error => { if (current) setListing({ key, people: [], capped: false, error: error.message }); });
    return () => { current = false; };
  }, [eventId, registeredOnly, key]);

  const term = query.trim();
  const loaded = listing.key === key ? listing : null;
  const capped = !!loaded?.capped;

  useEffect(() => {
    if (!capped || !term) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      searchPeople(supabase, term, 20, { eventId, registeredOnly })
        .then(people => { if (current) setResults({ key: `${key}|${term}`, people, error: null }); })
        .catch(error => { if (current) setResults({ key: `${key}|${term}`, people: [], error: error.message }); });
    }, SEARCH_DELAY_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [capped, term, eventId, registeredOnly, key]);

  let people = null;
  let error = loaded?.error ?? null;
  if (loaded && !error) {
    if (!capped) people = loaded.people.filter(person => matchesPerson(person, term));
    else if (term && results.key === `${key}|${term}`) { people = results.people; error = results.error; }
  }

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="team-add-title">
      <h2 id="team-add-title" className="text-lg font-semibold text-ink">{fr.teamAddTitle}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label={fr.teamAddRoleLabel} htmlFor="team-add-role">
          <RoleSelect id="team-add-role" value={role} onChange={setRole} options={ACCESS_ROLE_OPTIONS} />
        </Field>
        <Field label={fr.teamSearchLabel} hint={fr.teamSearchHint} htmlFor="team-search">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
            <Input id="team-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={fr.teamSearchPlaceholder} autoComplete="off" className="pl-10" />
          </div>
        </Field>
      </div>
      <Toggle className="mt-4" checked={registeredOnly} onChange={setRegisteredOnly}
        label={fr.teamRegisteredOnly} description={fr.teamRegisteredOnlyHint} />

      {error && <Notice tone="bad" className="mt-4">{error}</Notice>}
      {!error && capped && !term && <p className="mt-4 text-sm text-faint" role="status">{fr.teamPeopleTooMany}</p>}
      {!error && !loaded && <ListSkeleton />}
      {!error && people && (people.length === 0 ? (
        <p className="mt-4 text-sm text-faint" role="status">{fr.teamSearchEmpty}</p>
      ) : (
        <ul className="mt-4 max-h-96 divide-y divide-line overflow-y-auto rounded-control border border-line" aria-label={fr.teamSearchLabel}>
          {people.map(person => {
            const name = personLabel(person);
            const level = levelOf(person, team);
            return (
              <li key={person.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{name}</p>
                  {person.full_name && <p className="truncate text-sm text-faint">{person.email}</p>}
                </div>
                <LevelTag level={level} />
                {level !== 'admin' && level !== role && (
                  <Button variant="secondary" size="sm" loading={busyId === person.id} onClick={() => onAdd(person, role)}
                    aria-label={(level ? fr.teamChangeFor : fr.teamAddFor).replace('{role}', getAccessRoleLabel(role)).replace('{name}', name)}>
                    {level ? fr.teamChangeTo.replace('{role}', getAccessRoleLabel(role)) : fr.teamAdd}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ))}
    </Card>
  );
};

const TeamSection = () => {
  const { events, activeEvent, loading, error } = useEvents();
  const [chosenId, setChosenId] = useState('');
  const eventId = (chosenId && events.some(event => event.id === chosenId) ? chosenId : activeEvent?.id || events[0]?.id) || '';
  const edition = events.find(event => event.id === eventId);
  const [data, setData] = useState({ eventId: null, team: null, admins: null, log: null, error: null });
  const [reloads, setReloads] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [pendingRemoval, setPendingRemoval] = useState(null);
  // The admin flag asks first, both ways: { person, grant }.
  const [pendingAdmin, setPendingAdmin] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const { addToast } = useToasts(1699);

  useEffect(() => {
    if (!eventId) return undefined;
    let current = true;
    Promise.all([listEditionTeam(supabase, eventId), listAdmins(supabase), listEditionRoleLog(supabase, eventId), listAdminRoleLog(supabase)])
      .then(([team, admins, roleLog, adminLog]) => {
        if (current) setData({ eventId, team, admins, log: mergeTeamLog(roleLog, adminLog), error: null });
      })
      .catch(loadError => { if (current) setData({ eventId, team: null, admins: null, log: null, error: loadError.message }); });
    return () => { current = false; };
  }, [eventId, reloads]);

  // Who is signed in: one can't remove one's own admin flag.
  useEffect(() => {
    let current = true;
    fetchCurrentUserId(supabase).then(id => { if (current) setCurrentUser(id); });
    return () => { current = false; };
  }, []);

  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  if (!events.length) return <EmptyState icon={UsersRound} title={fr.teamNoEvents} />;

  const shown = data.eventId === eventId ? data : null;
  const team = shown?.team ?? [];
  const admins = shown?.admins ?? [];

  const change = async (person, role) => {
    const name = personLabel(person);
    setBusyId(person.id);
    try {
      await setEditionRole(supabase, { eventId, userId: person.id, role });
      addToast(role
        ? fr.teamRoleSetToast.replace('{name}', name).replace('{role}', getEditionRoleLabel(role))
        : fr.teamRoleRemovedToast.replace('{name}', name), 'success');
      setReloads(n => n + 1);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const changeAdmin = async () => {
    const { person, grant } = pendingAdmin;
    const name = personLabel(person);
    setBusyId(person.id);
    try {
      await setIsAdmin(supabase, { profileId: person.id, isAdmin: grant, currentUser });
      addToast((grant ? fr.teamAdminGrantedToast : fr.teamAdminRemovedToast).replace('{name}', name), 'success');
      setReloads(n => n + 1);
    } catch (err) {
      addToast(err.message, err.message === fr.selfAdminToggleError ? 'warning' : 'error');
    } finally {
      setBusyId(null);
      setPendingAdmin(null);
    }
  };

  // Admin isn't an edition role: it is confirmed, then goes through admin_set_is_admin().
  const give = (person, role) => (role === 'admin' ? setPendingAdmin({ person, grant: true }) : change(person, role));

  const confirmRemoval = async () => {
    const member = pendingRemoval;
    if (!member) return;
    await change(member.person, null);
    setPendingRemoval(null);
  };

  return (
    <div className="space-y-6">
      <RolesHelp />

      <Field label={fr.teamEditionLabel} htmlFor="team-edition" className="sm:max-w-sm">
        <Select id="team-edition" value={eventId} onChange={e => setChosenId(e.target.value)}>
          {events.map(event => <option key={event.id} value={event.id}>{eventOption(event)}</option>)}
        </Select>
      </Field>

      {shown?.error && (
        <Notice tone="bad" title={fr.adminLoadError}
          action={<Button variant="secondary" size="sm" onClick={() => setReloads(n => n + 1)}>{fr.retry}</Button>}>
          {shown.error}
        </Notice>
      )}

      <Card className="p-5 sm:p-6" aria-labelledby="team-admins-title">
        <h2 id="team-admins-title" className="text-lg font-semibold text-ink">{fr.teamAdminsTitle}</h2>
        <p className="text-sm text-faint">{fr.teamAdminsHint}</p>
        {!shown ? <ListSkeleton /> : (
          <ul className="mt-3 divide-y divide-line" aria-labelledby="team-admins-title">
            {admins.map(person => {
              const name = personLabel(person);
              const reason = person.id === currentUser ? fr.teamAdminRemoveSelf : isRootAdmin(person) ? fr.teamAdminRemoveRoot : null;
              return (
                <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-semibold text-ink">{name}</p>
                    {person.full_name && <p className="truncate text-sm text-faint">{person.email}</p>}
                  </div>
                  <Tag tone="info">{fr.teamAdminTag}</Tag>
                  <Button variant="secondary" size="icon" disabled={!!reason || !currentUser}
                    onClick={() => setPendingAdmin({ person, grant: false })}
                    aria-label={fr.teamAdminRemoveFor.replace('{name}', name)} title={reason || fr.teamAdminRemoveFor.replace('{name}', name)}>
                    <UserMinus aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                  </Button>
                  {reason && <p className="basis-full text-sm text-faint">{reason}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-5 sm:p-6" aria-labelledby="team-members-title">
        <h2 id="team-members-title" className="text-lg font-semibold text-ink">{fr.teamMembersTitle}</h2>
        {!shown ? <ListSkeleton /> : team.length === 0 ? (
          <p className="mt-4 text-sm text-faint">{fr.teamMembersEmpty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line" aria-labelledby="team-members-title">
            {team.map(member => {
              const name = personLabel(member.person);
              return (
                <li key={member.person.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-semibold text-ink">{name}</p>
                    {member.person.full_name && <p className="truncate text-sm text-faint">{member.person.email}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <RoleSelect value={member.role} onChange={role => change(member.person, role)} disabled={busyId === member.person.id}
                      aria-label={fr.teamRoleFor.replace('{name}', name)} className="w-44" />
                    <Button variant="secondary" size="icon" onClick={() => setPendingRemoval(member)}
                      aria-label={fr.teamRemoveFor.replace('{name}', name)} title={fr.teamRemoveFor.replace('{name}', name)}>
                      <UserMinus aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <AddPerson team={team} eventId={eventId} reloads={reloads} onAdd={give} busyId={busyId} />

      <Card className="p-5 sm:p-6" aria-labelledby="team-log-title">
        <h2 id="team-log-title" className="text-lg font-semibold text-ink">{fr.teamLogTitle}</h2>
        {!shown ? <ListSkeleton /> : (shown.log ?? []).length === 0 ? (
          <EmptyState icon={History} title={fr.teamLogEmpty} className="py-8" />
        ) : (
          <ol className="mt-3 divide-y divide-line" aria-labelledby="team-log-title">
            {shown.log.map(entry => (
              <li key={`${entry.kind}-${entry.id}`} className="py-3">
                <p className="text-sm text-ink">{logLine(entry)}</p>
                <p className="mt-0.5 font-data text-xs text-faint">{formatHistoryTimestamp(entry.changedAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <ConfirmDialog
        open={!!pendingRemoval}
        title={fr.teamRemoveTitle}
        confirmLabel={fr.teamRemoveTitle}
        onConfirm={confirmRemoval}
        onCancel={() => setPendingRemoval(null)}
        loading={!!pendingRemoval && busyId === pendingRemoval.person.id}
      >
        {pendingRemoval && fr.teamRemoveConfirm
          .replace('{name}', personLabel(pendingRemoval.person))
          .replace('{role}', getEditionRoleLabel(pendingRemoval.role))
          .replace('{edition}', edition?.theme || fr.historyEmptyValue)}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pendingAdmin}
        tone={pendingAdmin?.grant ? 'primary' : 'danger'}
        title={pendingAdmin?.grant ? fr.teamAdminGrantTitle : fr.teamAdminRemoveTitle}
        confirmLabel={pendingAdmin?.grant ? fr.teamAdminGrantTitle : fr.teamAdminRemoveTitle}
        onConfirm={changeAdmin}
        onCancel={() => setPendingAdmin(null)}
        loading={!!pendingAdmin && busyId === pendingAdmin.person.id}
      >
        {pendingAdmin && (pendingAdmin.grant ? fr.teamAdminGrantConfirm : fr.teamAdminRemoveConfirm)
          .replace('{name}', personLabel(pendingAdmin.person))}
      </ConfirmDialog>
    </div>
  );
};

export default TeamSection;
