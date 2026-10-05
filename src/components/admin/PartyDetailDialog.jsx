import { Eye, MessageSquareText, Pencil } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatCurrency, formatDateTime } from '../../lib/format';
import { amountOwedOf } from '../../lib/adminStats';
import { initials } from '../../lib/eventDisplay';
import {
  PAYMENT_STATUS,
  getPaymentStatusShortLabel,
  getRegistrationStatusLabel,
  isActiveRegistration
} from '../../lib/registrationOptions';
import { AttendeeList, InfoBlock, RegistrationInputs } from '../RegistrationDetails';
import { Button, Card, Dialog, Tag } from '../ui';
import PartyEmailLog from './PartyEmailLog';
import { canViewAs } from '../../lib/voirComme';

const Fact = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-sm text-muted">{label}</dt>
    <dd className="mt-0.5 text-ink">{children}</dd>
  </div>
);

// « Inscription »: one registration, read-only, for everyone who sees the Inscrits list. What the
// role doesn't allow isn't there (#217): « Modifier » (the god-mode editor) is the admin's
// `onEdit`, the email log `showEmailLog` (Organisateur and above; email_log's RLS refuses Comité).
// `party` null is closed. The member's profile and history open from « Voir le profil ».
// « Voir comme » (#267) is the admin's `onViewAs`, offered on a registrant who isn't an admin nor
// deleted: it opens the member's read-only session in a new tab.
// `showFinances` false (Comité, #290): no payment status nor amount; its parties don't carry them.
const PartyDetailDialog = ({ party, onClose, onViewProfile, onEdit, onViewAs, showEmailLog, showFinances = true }) => {
  const profile = party?.profiles || {};
  const viewAs = onViewAs && canViewAs(profile) ? onViewAs : null;
  const cancelled = party ? !isActiveRegistration(party) : false;
  const isPaid = party?.payment_status === PAYMENT_STATUS.PAID;
  return (
    <Dialog
      open={!!party}
      onClose={onClose}
      size="lg"
      title={fr.partyDetailTitle}
      footer={party && (onEdit || viewAs) && (
        <>
          {viewAs && (
            <Button variant="secondary" onClick={() => viewAs(profile)}>
              <Eye aria-hidden="true" className="size-4.5" strokeWidth={2} />
              {fr.voirCommeAction}
            </Button>
          )}
          {onEdit && (
            <Button onClick={() => onEdit(party)}>
              <Pencil aria-hidden="true" className="size-4.5" strokeWidth={2} />
              {fr.edit}
            </Button>
          )}
        </>
      )}
    >
      {party && (
        <div className="space-y-6 px-5 py-5 sm:px-6">
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-raised font-data text-lg text-neon">
              {initials(profile.full_name || profile.email)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-ink">{profile.full_name || fr.notSpecified}</p>
              <p className="truncate text-sm text-muted">{profile.email}</p>
              <button
                type="button"
                onClick={() => onViewProfile(profile)}
                className="mt-1 text-sm font-semibold text-ink underline decoration-edge underline-offset-4 hover:decoration-neon"
              >
                {fr.partyDetailViewProfile}
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-4 rounded-control bg-night/60 p-4 sm:grid-cols-3">
            <Fact label={fr.partyDetailStatus}>
              <span className="flex flex-wrap gap-2">
                <Tag>{getRegistrationStatusLabel(party.status)}</Tag>
                {party.is_waitlisted && <Tag tone="warn">{fr.filterWaitlist}</Tag>}
              </span>
            </Fact>
            {showFinances && (
              <>
                <Fact label={fr.paymentColumn}>
                  <Tag tone={isPaid ? 'ok' : 'warn'}>{getPaymentStatusShortLabel(party.payment_status)}</Tag>
                </Fact>
                <Fact label={fr.amountDue}>
                  <span className="font-data">{formatCurrency(cancelled ? 0 : amountOwedOf(party))}</span>
                </Fact>
              </>
            )}
            <Fact label={fr.partyDetailRegisteredOn}>{formatDateTime(party.created_at) || fr.notSpecified}</Fact>
            <Fact label={fr.partyDetailEditedOn}>
              {party.last_edited_at ? formatDateTime(party.last_edited_at) : fr.neverEditedMessage}
            </Fact>
          </dl>

          {showEmailLog && <PartyEmailLog partyId={party.id} />}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card className="min-w-0 p-5">
              <h3 className="text-lg font-semibold text-ink">{fr.attendeesList}</h3>
              <AttendeeList attendees={party.attendees || []} className="mt-4" />
            </Card>
            <Card className="min-w-0 space-y-5 p-5">
              <h3 className="text-lg font-semibold text-ink">{fr.partyDetailInputs}</h3>
              <RegistrationInputs registration={party} />
              {party.message_to_participants?.trim() && (
                <InfoBlock icon={MessageSquareText} title={fr.messageFromOrganizers}>
                  <p className="whitespace-pre-line [overflow-wrap:anywhere]">{party.message_to_participants.trim()}</p>
                </InfoBlock>
              )}
            </Card>
          </div>
        </div>
      )}
    </Dialog>
  );
};

export default PartyDetailDialog;
