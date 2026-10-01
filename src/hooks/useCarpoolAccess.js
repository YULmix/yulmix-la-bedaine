import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Whether the carpool board (#180) is for the signed-in user: an admin, or confirmed for the active
// event, not waitlisted (the database's can_view_carpool_board(), which the board checks again).
// Asked again on every page change, so registering, cancelling or leaving the waitlist shows or
// hides the nav item.
export const useCarpoolAccess = (enabled) => {
  const { pathname } = useLocation();
  const [canView, setCanView] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setCanView(false);
      return undefined;
    }
    let ignore = false;
    supabase.rpc('can_view_carpool_board').then(({ data, error }) => {
      if (ignore) return;
      if (error) console.error('Error checking carpool board access:', error);
      setCanView(data === true);
    });
    return () => { ignore = true; };
  }, [enabled, pathname]);

  return canView;
};
