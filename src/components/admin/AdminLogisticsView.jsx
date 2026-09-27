import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, BED_REASON_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';

// Shared by the bed input and notes textarea. text-base below md keeps iOS Safari from
// zooming the page when the field gets focus (it does for anything under 16px).
const FIELD_CLASS = 'w-full px-3 py-2 md:px-2 md:py-1 border border-gray-300 rounded text-base md:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-600 placeholder:text-slate-300 bg-white/50';

// Per-party sleeping assignments and private admin notes. Unsaved edits live in the parent
// (`logisticsChanges`) so they survive switching admin tabs.
//
// One markup for all screen sizes: each attendee is a stacked card on mobile and a row of a
// four-column grid from md up, where the column headers appear and the inline labels hide.
const AdminLogisticsView = ({
  parties,
  logisticsChanges,
  onAssignedBedChange,
  onAdminNotesChange,
  onSave,
  onOpenUserProfile
}) => (
  <div className="bg-indigo-50 rounded-xl shadow-lg p-4 md:p-6 mb-8">
    <h2 className="text-xl font-semibold text-gray-800 mb-2 md:mb-4">{fr.logisticsViewTitle}</h2>
    <p className="text-sm text-gray-600 mb-4">{fr.logisticsViewDescription}</p>

    <div className="space-y-4">
      {parties.map(party => {
        const profile = party.profiles || {};
        const partyAttendees = party.attendees || [];
        const changes = logisticsChanges[party.id] || {};
        const hasChanges = changes.adminNotes !== undefined || (changes.attendees && Object.keys(changes.attendees).length > 0);
        const notesId = `admin-notes-${party.id}`;

        return (
          <div key={party.id} className="border border-gray-200 rounded-lg p-3 md:p-4 bg-teal-50/50">
            <div className="mb-3 min-w-0">
              <button
                onClick={() => onOpenUserProfile(profile)}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left py-1"
              >
                {profile.full_name || fr.notSpecified}
              </button>
              <p className="text-sm text-gray-500 break-all">{profile.email}</p>
            </div>

            <div className="hidden md:grid md:grid-cols-4 md:gap-4 px-2 pb-2 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase">
              <span>{fr.logisticsTableAttendee}</span>
              <span>{fr.logisticsTableSleepingPref}</span>
              <span>{fr.bedReason}</span>
              <span>{fr.logisticsTableSleepingAssigned}</span>
            </div>
            <ul className="space-y-3 md:space-y-0 md:divide-y md:divide-gray-100">
              {partyAttendees.map((attendee, index) => {
                const assignedValue = changes.attendees && changes.attendees[index] !== undefined
                  ? changes.attendees[index]
                  : (attendee.assigned_bed || '');
                const attendeeName = attendee.name || `${fr.participantFallback} #${index + 1}`;
                const bedInputId = `assigned-bed-${party.id}-${index}`;

                return (
                  <li key={index} className="rounded-lg bg-gray-50 p-3 md:bg-transparent md:rounded-none md:grid md:grid-cols-4 md:gap-4 md:items-center md:px-2 md:py-2 text-sm text-gray-800">
                    <div className="font-medium md:font-normal mb-1 md:mb-0">{attendeeName}</div>
                    <div className="mb-1 md:mb-0">
                      <span className="text-gray-500 md:hidden">{fr.logisticsTableSleepingPref} : </span>
                      {getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference)}
                      {attendee.sleeping_preference === 'outside_other' && attendee.sleeping_preference_other && (
                        <span className="block text-xs text-gray-500">{attendee.sleeping_preference_other}</span>
                      )}
                    </div>
                    <div className="mb-2 md:mb-0">
                      <span className="text-gray-500 md:hidden">{fr.bedReason} : </span>
                      {getOptionLabel(BED_REASON_OPTIONS, attendee.bed_reason)}
                      {attendee.bed_reason === 'other' && attendee.bed_reason_other && (
                        <span className="block text-xs text-gray-500">{attendee.bed_reason_other}</span>
                      )}
                    </div>
                    <div>
                      <label htmlFor={bedInputId} className="block text-xs font-medium text-gray-500 uppercase mb-1 md:sr-only">
                        {fr.logisticsTableSleepingAssigned}
                      </label>
                      <input
                        id={bedInputId}
                        type="text"
                        value={assignedValue}
                        onChange={(e) => onAssignedBedChange(party.id, index, e.target.value)}
                        placeholder={fr.assignedBedPlaceholder}
                        className={FIELD_CLASS}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3">
              <label htmlFor={notesId} className="block text-xs font-medium text-gray-500 uppercase mb-1">{fr.logisticsTableAdminNotes}</label>
              <textarea
                id={notesId}
                value={changes.adminNotes !== undefined ? changes.adminNotes : (party.admin_notes || '')}
                onChange={(e) => onAdminNotesChange(party.id, e.target.value)}
                rows="2"
                className={FIELD_CLASS}
                placeholder={fr.adminNotesPlaceholder}
              />
            </div>

            {/* Below the fields it saves, so on a phone it's right under the thumb after editing */}
            {hasChanges && (
              <div className="mt-3 flex md:justify-end">
                <button
                  onClick={() => onSave(party.id)}
                  className="w-full md:w-auto px-4 py-3 md:px-3 md:py-1 bg-blue-600 text-white text-sm font-medium rounded-lg md:rounded hover:bg-blue-700"
                >
                  {fr.saveAssignments}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

export default AdminLogisticsView;
