import { useEffect, useState } from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import fr from '../../locales/fr.json';
import { formatDateTime } from '../../lib/format';
import { plural } from '../../lib/eventDisplay';
import {
  EMAIL_PROBLEM_STATUSES,
  getEmailStatusLabel,
  getEmailStatusTone,
  getEmailTemplateLabel
} from '../../lib/registrationOptions';
import { Tag } from '../ui';

// Every email_log row for one party (#93), for the admin: all five statuses, recipient, date and
// Resend's error when it refused. Admins read email_log directly (its RLS lets them). Opens by
// itself when something needs following up.
const PartyEmailLog = ({ partyId }) => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!partyId) return undefined;
    let ignore = false;
    const load = async () => {
      const { data, error: loadError } = await supabase
        .from('email_log')
        .select('id, template, status, recipient, error, updated_at')
        .eq('party_id', partyId)
        .order('updated_at', { ascending: false });
      if (ignore) return;
      if (loadError) {
        console.error('Error loading email log:', loadError);
        setError(true);
        return;
      }
      setRows(data || []);
    };
    load();
    return () => { ignore = true; };
  }, [partyId]);

  const problems = (rows || []).filter(row => EMAIL_PROBLEM_STATUSES.includes(row.status)).length;

  return (
    <details open={problems > 0 || undefined} className="group mb-5 rounded-control border border-line bg-night/60">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
        <span className="flex items-center gap-2 whitespace-nowrap font-semibold text-ink">
          <Mail aria-hidden="true" className="size-4.5 text-faint" strokeWidth={1.75} />
          {fr.emailLogTitle}
          {rows && <span className="font-data text-xs text-faint">{rows.length}</span>}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {problems > 0 && <Tag tone="warn">{plural(problems, 'emailProblemsTitleOne', 'emailProblemsTitleOther')}</Tag>}
          <ArrowRight aria-hidden="true" className="size-4 text-faint transition group-open:rotate-90" />
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        {error && <p className="text-sm text-bad">{fr.emailLogLoadError}</p>}
        {rows && rows.length === 0 && <p className="text-sm text-muted">{fr.emailLogEmpty}</p>}
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-line">
            {rows.map(row => (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{getEmailTemplateLabel(row.template)}</span>
                  <Tag tone={getEmailStatusTone(row.status)}>{getEmailStatusLabel(row.status)}</Tag>
                </div>
                <p className="mt-1 text-sm text-muted">
                  <span className="font-data text-xs text-faint">{formatDateTime(row.updated_at)}</span>
                  {row.recipient && <span className="block break-all">{fr.emailLogRecipient} {row.recipient}</span>}
                </p>
                {row.error && <p className="mt-1 break-words font-data text-xs text-bad">{row.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
};

export default PartyEmailLog;
