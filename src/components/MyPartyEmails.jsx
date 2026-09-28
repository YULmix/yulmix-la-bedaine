import { useEffect, useState } from 'react';
import { Check, CircleAlert, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import { formatShortDate } from '../lib/format';
import { EMAIL_STATUS, getEmailStatusLabel, getEmailTemplateLabel } from '../lib/registrationOptions';
import { Card } from './ui';

// The member's own emails (#93), newest first, under their Pass. my_party_emails() already
// leaves out anything that was never sent (pending, dry run, backfilled) and every detail a member
// shouldn't see, so this renders what it gets. "Envoyé", never "reçu": we don't know it arrived.
// Hidden while there is nothing to show.
const MyPartyEmails = ({ registration }) => {
  const [emails, setEmails] = useState([]);
  const partyId = registration?.id;

  useEffect(() => {
    if (!partyId) return undefined;
    let ignore = false;
    const load = async () => {
      const { data, error } = await supabase.rpc('my_party_emails', { p_party_id: partyId });
      if (error) {
        console.error('Erreur lors du chargement des courriels:', error);
        return;
      }
      if (!ignore) setEmails(data || []);
    };
    load();
    return () => { ignore = true; };
    // A save can make a new email due: reload with the registration.
  }, [partyId, registration]);

  if (!emails.length) return null;
  const anySent = emails.some(email => email.status === EMAIL_STATUS.SENT);

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="my-party-emails-title">
      <h3 id="my-party-emails-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Mail aria-hidden="true" className="size-5 text-faint" strokeWidth={1.75} />
        {fr.emailsTitle}
      </h3>
      <ul className="mt-4 divide-y divide-line">
        {emails.map(email => {
          const sent = email.status === EMAIL_STATUS.SENT;
          const Icon = sent ? Check : CircleAlert;
          return (
            <li key={email.template} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${sent ? 'text-ok' : 'text-bad'}`} strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="text-ink">{getEmailTemplateLabel(email.template)}</p>
                <p className={`text-sm ${sent ? 'sr-only' : 'text-bad'}`}>{getEmailStatusLabel(email.status)}</p>
              </div>
              <span className="shrink-0 font-data text-sm text-faint">{formatShortDate(email.sent_at)}</span>
            </li>
          );
        })}
      </ul>
      {anySent && <p className="mt-4 text-sm text-muted">{fr.emailsNotReceivedHint}</p>}
    </Card>
  );
};

export default MyPartyEmails;
