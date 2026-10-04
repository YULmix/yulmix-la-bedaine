import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CANVAS_CLASS } from '../lib/pageWidth';
import fr from '../locales/fr.json';

const DISMISSED_KEY = 'feedbackBannerDismissedAt';
const POLL_INTERVAL_MS = 60000;

const ResolutionBanner = ({ isAuthenticated }) => {
  const [latestResolution, setLatestResolution] = useState(null);

  const checkLatestResolution = async () => {
    try {
      const { data, error } = await supabase.rpc('get_latest_feedback_resolution');
      if (error) throw error;
      if (!data) return;

      let dismissedAt = null;
      try {
        dismissedAt = window.localStorage.getItem(DISMISSED_KEY);
      } catch {
        // localStorage unavailable (private mode, blocked storage) — treat as never dismissed
      }

      if (!dismissedAt || new Date(data) > new Date(dismissedAt)) {
        setLatestResolution(data);
      }
    } catch (err) {
      console.error('Error checking feedback resolution status:', err);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    checkLatestResolution();
    const interval = setInterval(checkLatestResolution, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, latestResolution);
    } catch {
      // localStorage unavailable — banner will simply reappear on next check, not a hard failure
    }
    setLatestResolution(null);
  };

  if (!latestResolution) return null;

  return (
    <div role="status" className="border-b border-ok/30 tint-ok">
      <div className={`${CANVAS_CLASS} flex items-center justify-between gap-3 py-2`}>
        <p className="text-sm font-semibold text-ok">{fr.resolutionBannerMessage}</p>
        <button onClick={handleDismiss} aria-label={fr.resolutionBannerDismiss} className="grid size-9 place-items-center rounded-full text-ok hover:bg-ok/15">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default ResolutionBanner;
