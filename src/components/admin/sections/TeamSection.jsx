import { useEffect, useState } from 'react';
import { History, Search, UserMinus, UsersRound } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { supabase } from '../../../lib/supabase';
import { refreshEvents, useEvents } from '../../../lib/events';
import { EDITION_ROLE_OPTIONS, getEditionRoleLabel } from '../../../lib/registrationOptions';
import { listEditionRoleLog, listEditionTeam, personLabel, searchPeople, setEditionRole } from '../../../lib/team';
import { formatHistoryTimestamp } from '../../../lib/changeHistory';
import { useToasts } from '../../../hooks/useToasts';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Notice, Select, Skeleton, Tag } from '../../ui';
import { EVENT_STATUS } from '../AdminEvents';
import SectionStatus from './SectionStatus';

// « Équipe » (#217, ADR 0023): for one edition, the people with a role (Comité, Organisateur),
// giving someone one (any account, registered for the edition or not), changing or removing it,
// and the log of every change. Admin-only (the section registry and the database both say so).

const SEARCH_DELAY_MS = 250;

const eventOption = (event) => fr.changeHistoryEventOption
  .replace('{theme}', event.theme || fr.historyEmptyValue)
  .replace('{status}', fr[(event.is_active ? EVENT_STATUS.ACTIVE : EVENT_STATUS[event.status] || EVENT_STATUS.DRAFT).key]);

const RoleSelect = ({ value, onChange, ...props }) => (
  <Select value={value} onChange={e => onChange(e.target.value)} {...props}>
    {EDITION_ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </Select>
);

const logLine = (entry) => {
  const actor = entry.actor ? personLabel(entry.actor) : fr.historySystemAuthor;
  const person = personLabel(entry.person);
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

// Finds accounts by name or email as the admin types, and gives the chosen role to one.
const AddPerson = ({ team, onAdd, busyId }) => {
  const [role, setRole] = useState(EDITION_ROLE_OPTIONS[0].value);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ query: '', people: [], error: null });

  useEffect(() => {
    const term = query.trim();
    if (!term) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      searchPeople(supabase, term)
        .then(people => { if (current) setResults({ query: term, people, error: null }); })
        .catch(error => { if (current) setResults({ query: term, people: [], error: error.message }); });
    }, SEARCH_DELAY_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [query]);

  const term = query.trim();
  const shown = term && results.query === term ? results : null;
  const roleOf = new Map(team.map(member => [member.person.id, member.role]));

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="team-add-title">
      <h2 id="team-add-title" className="text-lg font-semibold text-ink">{fr.teamAddTitle}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label={fr.teamAddRoleLabel} htmlFor="team-add-role">
          <RoleSelect id="team-add-role" value={role} onChange={setRole} />
        </Field>
        <Field label={fr.teamSearchLabel} hint={fr.teamSearchHint} htmlFor="team-search">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
            <Input id="team-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={fr.teamSearchPlaceholder} autoComplete="off" className="pl-10" />
          </div>
        </Field>
      </div>

      {shown?.error && <Notice tone="bad" className="mt-4">{shown.error}</Notice>}
      {shown && !shown.error && (shown.people.length === 0 ? (
        <p className="mt-4 text-sm text-faint" role="status">{fr.teamSearchEmpty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-control border border-line" aria-label={fr.teamSearchLabel}>
          {shown.people.map(person => {
            const name = personLabel(person);
            const current = roleOf.get(person.id);
            return (
              <li key={person.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{name}</p>
                  {person.full_name && <p className="truncate text-sm text-faint">{person.email}</p>}
                </div>
                {person.isAdmin ? (
                  <Tag tone="info">{fr.teamAdminTag}</Tag>
                ) : current === role ? (
                  <Tag tone="ok">{getEditionRoleLabel(current)}</Tag>
                ) : current ? (
                  // Already on the team with the other role: say so, and offer the change by name.
                  <div className="flex shrink-0 items-center gap-2">
                    <Tag>{getEditionRoleLabel(current)}</Tag>
                    <Button variant="secondary" size="sm" loading={busyId === person.id} onClick={() => onAdd(person, role)}
                      aria-label={fr.teamChangeFor.replace('{role}', getEditionRoleLabel(role)).replace('{name}', name)}>
                      {fr.teamChangeTo.replace('{role}', getEditionRoleLabel(role))}
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" size="sm" loading={busyId === person.id} onClick={() => onAdd(person, role)}
                    aria-label={fr.teamAddFor.replace('{role}', getEditionRoleLabel(role)).replace('{name}', name)}>
                    {fr.teamAdd}
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
  const [data, setData] = useState({ eventId: null, team: null, log: null, error: null });
  const [reloads, setReloads] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const { addToast } = useToasts(1699);

  useEffect(() => {
    if (!eventId) return undefined;
    let current = true;
    Promise.all([listEditionTeam(supabase, eventId), listEditionRoleLog(supabase, eventId)])
      .then(([team, log]) => { if (current) setData({ eventId, team, log, error: null }); })
      .catch(loadError => { if (current) setData({ eventId, team: null, log: null, error: loadError.message }); });
    return () => { current = false; };
  }, [eventId, reloads]);

  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  if (!events.length) return <EmptyState icon={UsersRound} title={fr.teamNoEvents} />;

  const shown = data.eventId === eventId ? data : null;
  const team = shown?.team ?? [];

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

  const confirmRemoval = async () => {
    const member = pendingRemoval;
    if (!member) return;
    await change(member.person, null);
    setPendingRemoval(null);
  };

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-muted">{fr.teamIntro}</p>

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

      <AddPerson team={team} onAdd={change} busyId={busyId} />

      <Card className="p-5 sm:p-6" aria-labelledby="team-log-title">
        <h2 id="team-log-title" className="text-lg font-semibold text-ink">{fr.teamLogTitle}</h2>
        {!shown ? <ListSkeleton /> : (shown.log ?? []).length === 0 ? (
          <EmptyState icon={History} title={fr.teamLogEmpty} className="py-8" />
        ) : (
          <ol className="mt-3 divide-y divide-line" aria-labelledby="team-log-title">
            {shown.log.map(entry => (
              <li key={entry.id} className="py-3">
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
    </div>
  );
};

export default TeamSection;
