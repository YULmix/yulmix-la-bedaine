import { useState } from 'react';
import { ClipboardCopy, Download, Share } from 'lucide-react';
import fr from '../../locales/fr.json';
import { EXPORTS, exportFileName, toCsv, toTsv } from '../../lib/dataExport';
import { Button, ChipGroup, Dialog } from '../ui';
import { AdminHeaderActions } from './AdminNav';

// Inscrits' « Exporter » (#178, #209): an action in the page header opening a dialog, a bottom
// sheet on phones. Pick « Par groupe » or « Par participant », then a CSV download or a copy for
// Google Sheets. Both outputs are built from the same rows (src/lib/dataExport.js), of the active
// event's active parties.
const ExportDialog = ({ event, parties, addToast }) => {
  const [open, setOpen] = useState(false);
  const [exportId, setExportId] = useState(EXPORTS[0].id);
  const hasData = parties.length > 0;
  const { build, filePrefix } = EXPORTS.find(item => item.id === exportId);

  const exportToCSV = () => {
    if (!hasData) {
      addToast(fr.noDataToExport, 'warning');
      return;
    }
    const blob = new Blob([toCsv(build(parties))], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(filePrefix, event.theme);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast(fr.exportCSVToast, 'success');
  };

  const copyToClipboardForSheets = () => {
    if (!hasData) {
      addToast(fr.noDataToCopy, 'warning');
      return;
    }
    navigator.clipboard.writeText(toTsv(build(parties))).then(() => {
      addToast(fr.exportCopyToast, 'success');
    }).catch(err => {
      console.error('Failed to copy:', err);
      addToast(fr.copyError, 'error');
    });
  };

  return (
    <>
      <AdminHeaderActions>
        {/* Icon only on a phone, to stay on the title's line. */}
        <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={fr.adminExportAction} className="max-sm:px-3">
          <Share aria-hidden="true" className="size-4.5" strokeWidth={1.75} /><span className="max-sm:hidden">{fr.adminExportAction}</span>
        </Button>
      </AdminHeaderActions>
      <Dialog open={open} onClose={() => setOpen(false)} title={fr.dataExportTitle} size="sm">
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
          <p className="text-sm text-muted">{fr.dataExportDescription}</p>
          <ChipGroup
            className="mt-5"
            label={fr.exportChoiceLabel}
            options={EXPORTS.map(item => ({ value: item.id, label: fr[item.labelKey] }))}
            value={exportId}
            onChange={setExportId}
            size="sm"
          />
          <div className="mt-4 flex flex-col gap-3">
            <Button variant="secondary" onClick={exportToCSV} disabled={!hasData}>
              <Download aria-hidden="true" className="size-4.5" strokeWidth={1.75} />{fr.exportCSVButton}
            </Button>
            <Button variant="secondary" onClick={copyToClipboardForSheets} disabled={!hasData}>
              <ClipboardCopy aria-hidden="true" className="size-4.5" strokeWidth={1.75} />{fr.exportCopyTSVButton}
            </Button>
          </div>
          <p className="mt-3 text-sm text-faint">{fr.exportCopyTSVSubtext}</p>
        </div>
      </Dialog>
    </>
  );
};

export default ExportDialog;
