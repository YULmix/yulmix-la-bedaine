import { useMemo, useState } from 'react';
import { BedDouble, Save } from 'lucide-react';
import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, BED_REASON_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { Button, Card, EmptyState, Input, Tag, Textarea } from '../ui';
import { FilterPills } from './AdminUserManagement';

const wantsBed = party => (party.attendees || []).some(a => a.sleeping_preference === 'bed');
const hasUnassigned = party => (party.attendees || []).some(a => !a.assigned_bed);

const FILTERS = [
  { id: 'all', labelKey: 'filterAll', test: () => true },
  { id: 'bed', labelKey: 'filterBedRequested', test: wantsBed },
  { id: 'unassigned', labelKey: 'filterUnassigned', test: hasUnassigned }
];

// Per-party sleeping assignments and private admin notes. Unsaved edits live in the parent
// (`logisticsChanges`) so they survive switching admin tabs.
const AdminLogisticsView = ({
  parties,
  logisticsChanges,
  onAssignedBedChange,
  onAdminNotesChange,
  onSave,
  onOpenUserProfile
}) => {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.id, parties.filter(f.test).length])), [parties]);
  const activeFilter = FILTERS.find(f => f.id === filter) || FILTERS[0];
  const visible = parties.filter(activeFilter.test);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-ink">{fr.logisticsViewTitle}</h2>
        <p className="mt-2 max-w-prose text-muted">{fr.logisticsViewDescription}</p>
      </div>

      <FilterPills filters={FILTERS} value={filter} onChange={setFilter} counts={counts} label={fr.filterLabel} />

      {visible.length === 0 && <EmptyState icon={BedDouble} title={fr.noMatchingParties} />}

      <ul className="grid gap-4 xl:grid-cols-2">
        {visible.map(party => {
          const profile = party.profiles || {};
          const partyAttendees = party.attendees || [];
          const changes = logisticsChanges[party.id] || {};
          const hasChanges = changes.adminNotes !== undefined || (changes.attendees && Object.keys(changes.attendees).length > 0);
          const notesId = `admin-notes-${party.id}`;

          return (
            <li key={party.id}>
              <Card className={`h-full p-4 sm:p-5 ${hasChanges ? 'border-warn/50' : ''}`}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      onClick={() => onOpenUserProfile(profile)}
                      className="max-w-full truncate text-left text-lg font-semibold text-ink underline decoration-edge underline-offset-4 hover:decoration-neon"
                    >
                      {profile.full_name || fr.notSpecified}
                    </button>
                    <p className="truncate text-sm text-faint">{profile.email}</p>
                  </div>
                  {hasChanges && <Tag tone="warn">{fr.unsavedTag}</Tag>}
                </div>

                <ul className="space-y-3">
                  {partyAttendees.map((attendee, index) => {
                    const assignedValue = changes.attendees && changes.attendees[index] !== undefined
                      ? changes.attendees[index]
                      : (attendee.assigned_bed || '');
                    const attendeeName = attendee.name || `${fr.participantFallback} #${index + 1}`;
                    const bedInputId = `assigned-bed-${party.id}-${index}`;
                    const reason = attendee.bed_reason === 'other' && attendee.bed_reason_other
                      ? attendee.bed_reason_other
                      : attendee.bed_reason ? getOptionLabel(BED_REASON_OPTIONS, attendee.bed_reason) : '';
                    const preference = attendee.sleeping_preference === 'outside_other' && attendee.sleeping_preference_other
                      ? attendee.sleeping_preference_other
                      : getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference);

                    return (
                      <li key={index} className="grid gap-2 rounded-control bg-night/60 p-3 sm:grid-cols-[1fr_12rem] sm:items-center">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{attendeeName}</p>
                          <p className="text-sm text-muted">
                            {preference}
                            {reason && <span className="text-faint">{`, ${reason}`}</span>}
                          </p>
                        </div>
                        <div>
                          <label htmlFor={bedInputId} className="sr-only">{`${fr.logisticsTableSleepingAssigned}, ${attendeeName}`}</label>
                          <Input
                            id={bedInputId}
                            value={assignedValue}
                            onChange={(e) => onAssignedBedChange(party.id, index, e.target.value)}
                            placeholder={fr.assignedBedPlaceholder}
                            className="font-data"
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-4">
                  <label htmlFor={notesId} className="mb-1.5 block text-sm font-semibold text-muted">{fr.logisticsTableAdminNotes}</label>
                  <Textarea
                    id={notesId}
                    value={changes.adminNotes !== undefined ? changes.adminNotes : (party.admin_notes || '')}
                    onChange={(e) => onAdminNotesChange(party.id, e.target.value)}
                    rows={2}
                    placeholder={fr.adminNotesPlaceholder}
                  />
                </div>

                {/* Below the fields it saves, so on a phone it's right under the thumb after editing */}
                {hasChanges && (
                  <div className="mt-4 flex sm:justify-end">
                    <Button onClick={() => onSave(party.id)} className="w-full sm:w-auto">
                      <Save aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                      {fr.saveAssignments}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default AdminLogisticsView;
