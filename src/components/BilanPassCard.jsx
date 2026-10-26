import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MessageSquareText } from 'lucide-react';
import { Card } from './ui';
import fr from '../locales/fr.json';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import { canAnswerFeedback, fetchMyEventFeedback } from '../lib/eventFeedback';

// The primary button's look on a link (HomeView's, not imported: HomeView renders this card).
const LINK_CLASS = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-neon px-5 font-semibold text-night transition duration-150 hover:brightness-110 active:scale-[0.98]';

// On the pass (#316): the link to the event's « bilan » while its window is open and the member
// may answer, with the close date. The database says both (my_event_feedback(), #315); the card
// doesn't depend on whether the member answered, so it reads the same in « Voir comme ». A failed
// read just shows no card: the page itself says why when opened.
const BilanPassCard = ({ eventId }) => {
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!eventId) return undefined;
    let current = true;
    fetchMyEventFeedback(supabase, eventId)
      .then(result => { if (current) setFeedback(result); })
      .catch(() => { if (current) setFeedback(null); });
    return () => { current = false; };
  }, [eventId]);

  if (!canAnswerFeedback(feedback)) return null;

  return (
    <Card data-testid="bilan-pass-card" className="p-5 sm:p-6 animate-rise">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MessageSquareText aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-neon" strokeWidth={1.75} />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink">{fr.bilanPassTitle}</h3>
            <p className="mt-1 text-muted">{fr.bilanPassText.replace('{date}', formatDate(feedback.closes_on))}</p>
          </div>
        </div>
        <Link to={`/bilan/${eventId}`} className={`${LINK_CLASS} sm:shrink-0`}>
          {fr.bilanPassAction}
          <ArrowRight aria-hidden="true" className="size-4.5" />
        </Link>
      </div>
    </Card>
  );
};

export default BilanPassCard;
