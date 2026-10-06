import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { interacPayerName } from '../../supabase/functions/_shared/interac';

// The name a member pays under (#301): their account's full name, as the emails use it, so the
// transfer message reads the same on screen and in the mail. Until the profile loads (and if it
// can't) it is the first attendee's name, then the email, by the same rule as the emails.
// Under « Voir comme » the session is the impersonated member's, so it is their name.
export const useAccountName = (registration) => {
  const [account, setAccount] = useState({ fullName: null, email: '' });
  useEffect(() => {
    let ignore = false;
    (async () => {
      const { data: { user } = {} } = await supabase.auth.getUser();
      if (!user || ignore) return;
      const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      if (ignore) return;
      setAccount({ fullName: data?.full_name || user.user_metadata?.full_name || null, email: user.email || '' });
    })().catch(error => console.error('Error loading the account name:', error));
    return () => { ignore = true; };
  }, []);
  const attendeeNames = (registration?.attendees || []).map(attendee => attendee?.name);
  return interacPayerName(account.fullName, attendeeNames, account.email);
};
