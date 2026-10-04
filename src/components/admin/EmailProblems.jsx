import { useEffect, useState } from 'react';
import { MailWarning } from 'lucide-react';
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
import { Button, Notice, Tag } from '../ui';

// Vue d'ensemble (#93): the event's emails an organiser has to follow up by hand (failed, or
// pending and never finished), each naming its party. Absent when there are none.
const EmailProblems = ({ eventId, parties, onOpenParty }) => {
  const [rows, setRows] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!eventId) return undefined;
    let ignore = false;
    const load = async () => {
      const { data, error } = await supabase
        .from('email_log')
        .select('id, party_id, template, status, error, updated_at, user_parties!inner(event_id, profiles(full_name, email))')
        .eq('user_parties.event_id', eventId)
        .in('status', EMAIL_PROBLEM_STATUSES)
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('Error loading email problems:', error);
        return;
      }
      if (!ignore) setRows(data || []);
    };
    load();
    return () => { ignore = true; };
    // parties changes whenever a registration does (realtime), which is what makes emails due.
  }, [eventId, parties]);

  if (!rows.length) return null;

  return (
    <Notice
      tone="warn"
      icon={MailWarning}
      role="status"
      title={plural(rows.length, 'emailProblemsTitleOne', 'emailProblemsTitleOther')}
    >
      <p>{fr.emailProblemsHint}</p>
      <Button variant="secondary" size="sm" className="mt-3" aria-expanded={expanded} aria-controls="email-problems-list" onClick={() => setExpanded(value => !value)}>
        {expanded ? fr.emailProblemsHide : fr.emailProblemsShow}
      </Button>
      {expanded && (
        <ul id="email-problems-list" className="mt-3 divide-y divide-line text-ink">
          {rows.map(row => {
            const party = parties.find(p => p.id === row.party_id);
            const profile = row.user_parties?.profiles || {};
            return (
              <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{profile.full_name || profile.email || fr.notSpecified}</p>
                  <p className="text-muted">
                    {getEmailTemplateLabel(row.template)}
                    <span className="ml-2 font-data text-xs text-faint">{formatDateTime(row.updated_at)}</span>
                  </p>
                  {row.error && <p className="mt-1 break-words font-data text-xs text-bad">{row.error}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <Tag tone={getEmailStatusTone(row.status)}>{getEmailStatusLabel(row.status)}</Tag>
                  {party && onOpenParty && (
                    <Button variant="secondary" size="sm" onClick={() => onOpenParty(party)}>
                      {fr.emailProblemsOpenParty}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Notice>
  );
};

export default EmailProblems;
