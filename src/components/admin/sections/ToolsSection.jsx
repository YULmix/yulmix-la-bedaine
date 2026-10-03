import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, History, Inbox } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { TOOLS_VIEW_IDS, adminHref } from '../../../lib/adminRoutes';
import { refreshEvents, useEvents } from '../../../lib/events';
import { refreshAdminParties, useAdminParties } from '../../../lib/adminParties';
import { refreshFeedback, resolveFeedback, useFeedback } from '../../../lib/feedback';
import { EXPORTS, exportFileName, toCsv, toTsv } from '../../../lib/dataExport';
import { useToasts } from '../../../hooks/useToasts';
import { ChangeHistory, DataExport, FeedbackInbox } from '../AdminTools';
import { EmptyState, ViewPanel, ViewTabs } from '../../ui';
import NoActiveEvent from './NoActiveEvent';
import SectionStatus from './SectionStatus';

// The Outils views (/admin/tools/<view>), one job each, so the change history (#173) can have the
// screen to itself; the first is the default. #209 dissolves Outils into Inscrits and Retours.
const TOOLS_VIEW_DISPLAY = {
  exports: { labelKey: 'toolsViewExports', icon: Download },
  history: { labelKey: 'toolsViewHistory', icon: History },
  feedback: { labelKey: 'toolsViewFeedback', icon: Inbox }
};
const TOOLS_VIEWS = TOOLS_VIEW_IDS.map(id => ({ id, ...TOOLS_VIEW_DISPLAY[id] }));

// Data export (#178): both formats are built from the same rows (src/lib/dataExport.js), of the
// active event's active parties.
const ExportsView = ({ addToast }) => {
  const { activeEvent } = useEvents();
  const { activeParties, loading, error } = useAdminParties(activeEvent?.id);
  if (!activeEvent) return <NoActiveEvent />;
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={() => refreshAdminParties(activeEvent.id)} />;

  const exportOf = (exportId) => EXPORTS.find(item => item.id === exportId);

  const exportToCSV = (exportId) => {
    if (!activeParties.length) {
      addToast(fr.noDataToExport, 'warning');
      return;
    }
    const { build, filePrefix } = exportOf(exportId);
    const blob = new Blob([toCsv(build(activeParties))], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(filePrefix, activeEvent.theme);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast(fr.exportCSVToast, 'success');
  };

  const copyToClipboardForSheets = (exportId) => {
    if (!activeParties.length) {
      addToast(fr.noDataToCopy, 'warning');
      return;
    }
    navigator.clipboard.writeText(toTsv(exportOf(exportId).build(activeParties))).then(() => {
      addToast(fr.exportCopyToast, 'success');
    }).catch(err => {
      console.error('Failed to copy:', err);
      addToast(fr.copyError, 'error');
    });
  };

  return <DataExport hasData={activeParties.length > 0} onExportCSV={exportToCSV} onCopyTSV={copyToClipboardForSheets} />;
};

const HistoryView = ({ addToast }) => {
  const { events, loading, error } = useEvents();
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  return events.length > 0
    ? <ChangeHistory events={events} notify={addToast} />
    : <EmptyState icon={History} title={fr.changeHistoryEmpty} />;
};

const FeedbackView = ({ addToast }) => {
  const { items, loading, error } = useFeedback();
  const [showResolved, setShowResolved] = useState(false);
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

const VIEW_COMPONENTS = { exports: ExportsView, history: HistoryView, feedback: FeedbackView };

const ToolsSection = ({ view }) => {
  const navigate = useNavigate();
  const { addToast } = useToasts(1699);
  const View = VIEW_COMPONENTS[view] || ExportsView;
  return (
    <div className="space-y-6">
      <ViewTabs
        views={TOOLS_VIEWS.map(({ id, labelKey, icon }) => ({ id, label: fr[labelKey], icon }))}
        value={view}
        onChange={next => navigate(adminHref({ section: 'tools', view: next }))}
        label={fr.toolsViewsLabel}
        idPrefix="tools-view"
      />
      <ViewPanel idPrefix="tools-view" value={view}><View addToast={addToast} /></ViewPanel>
    </div>
  );
};

export default ToolsSection;
