import fr from '../../locales/fr.json';
import { formatCurrency, formatDate } from '../../lib/format';
import { initials } from '../../lib/eventDisplay';
import { PAYMENT_STATUS, getPaymentStatusShortLabel, getRegistrationStatusLabel } from '../../lib/registrationOptions';
import { Dialog, Tag } from '../ui';

// A member's identity and their registrations across editions (user_event_history view).
const UserProfileDialog = ({ profile, history, onClose }) => (
  <Dialog open={!!profile} onClose={onClose} title={fr.userProfileModalTitle} size="md">
    {profile && (
      <div className="space-y-6 px-5 py-5 sm:px-6">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-raised font-data text-lg text-neon">
            {initials(profile.full_name || profile.email)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{profile.full_name || fr.notSpecified}</p>
            <p className="truncate text-sm text-muted">{profile.email}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 rounded-control bg-night/60 p-4">
          <div>
            <dt className="text-sm text-muted">{fr.userProfileAdminStatus}</dt>
            <dd className="text-ink">{profile.is_admin ? fr.userProfileYes : fr.userProfileNo}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{fr.userProfileMemberSince}</dt>
            <dd className="text-ink">{formatDate(profile.created_at) || fr.notSpecified}</dd>
          </div>
        </dl>

        <section>
          <h3 className="mb-3 text-lg font-semibold text-ink">{fr.userProfileEventHistory}</h3>
          {history.length > 0 ? (
            <ul className="divide-y divide-line rounded-card border border-line">
              {history.map((entry, index) => (
                <li key={index} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{entry.event_theme}</p>
                    <p className="font-data text-xs text-faint">
                      {formatDate(entry.registration_date)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag>{getRegistrationStatusLabel(entry.registration_status)}</Tag>
                    {entry.is_waitlisted && <Tag tone="warn">{fr.filterWaitlist}</Tag>}
                    <Tag tone={entry.payment_status === PAYMENT_STATUS.PAID ? 'ok' : 'warn'}>{getPaymentStatusShortLabel(entry.payment_status)}</Tag>
                    <span className="font-data text-sm text-ink">{formatCurrency(entry.calculated_amount_owed)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-muted">{fr.noEventHistoryFound}</p>
          )}
        </section>
      </div>
    )}
  </Dialog>
);

export default UserProfileDialog;
