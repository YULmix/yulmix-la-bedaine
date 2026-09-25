import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';
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
    <div className="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between">
      <p className="text-sm font-medium">{fr.resolutionBannerMessage}</p>
      <button onClick={handleDismiss} aria-label={fr.resolutionBannerDismiss} className="p-1 rounded-full hover:bg-emerald-700">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default ResolutionBanner;
