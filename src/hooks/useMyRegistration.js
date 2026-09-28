import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// The signed-in member's registration (user_parties row) for the active event. Shared by the
// home page and /inscription so both read the same row the same way.
export const useMyRegistration = (activeEvent, isAuthenticated) => {
  const [registration, setRegistration] = useState(null);
  // Start in the loading state when there is something to fetch, so the page never flashes the
  // "not registered" view before the first query returns.
  const [loading, setLoading] = useState(!!(isAuthenticated && activeEvent?.id));
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!isAuthenticated || !activeEvent?.id) {
      setRegistration(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return;

      const { data, error: regError } = await supabase
        .from('user_parties')
        .select('*')
        .eq('user_id', user.id)
        .eq('event_id', activeEvent.id)
        .maybeSingle();
      if (regError) throw regError;
      setRegistration(data || null);
    } catch (err) {
      console.error('Erreur lors de la récupération de l\'inscription:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, activeEvent?.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { registration, setRegistration, loading, error, refetch };
};
