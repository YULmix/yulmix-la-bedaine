import { useState } from 'react';
import { CheckCircle2, Inbox } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { refreshFeedback, resolveFeedback, useFeedback } from '../../../lib/feedback';
import { useToasts } from '../../../hooks/useToasts';
import { Button, Card, EmptyState, Tag, Toggle } from '../../ui';
import SectionStatus from './SectionStatus';

// Retours (#209, was a view of Outils): what users sent through the feedback dialog, with a
// « show resolved » filter. The section's marker is the unresolved count
// (src/views/AdminView.jsx).

const FeedbackInbox = ({ items, showResolved, onToggleResolved, onResolve }) => {
  const visible = items.filter(item => showResolved || !item.is_resolved);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-ink">{fr.adminFeedbackSectionTitle}</h3>
        <Toggle label={fr.adminFeedbackShowResolved} checked={showResolved} onChange={onToggleResolved} className="sm:justify-end" />
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={Inbox} title={fr.adminFeedbackEmpty} />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {visible.map(item => (
            <li key={item.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{item.profiles?.full_name || item.profiles?.email || fr.adminFeedbackUnknownAuthor}</p>
                  <p className="font-data text-xs text-faint">{new Date(item.created_at).toLocaleString('fr-CA')}</p>
                </div>
                {item.is_resolved ? (
                  <Tag tone="ok" icon={CheckCircle2}>{fr.adminFeedbackResolved}</Tag>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => onResolve(item.id)}>{fr.adminFeedbackResolve}</Button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{item.content}</p>
              {item.screenshot_url && (
                <a href={item.screenshot_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block">
                  <img src={item.screenshot_url} alt={fr.feedbackScreenshotAlt} loading="lazy" className="max-h-48 rounded-control border border-line" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

const FeedbackSection = () => {
  const { items, loading, error } = useFeedback();
  const [showResolved, setShowResolved] = useState(false);
  const { addToast } = useToasts(1699);
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshFeedback} />;

  const handleResolve = async (id) => {
    try {
      await resolveFeedback(id);
      addToast(fr.adminFeedbackResolve, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return <FeedbackInbox items={items} showResolved={showResolved} onToggleResolved={setShowResolved} onResolve={handleResolve} />;
};

export default FeedbackSection;
