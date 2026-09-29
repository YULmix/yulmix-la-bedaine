import { Check, Save, TriangleAlert, Undo2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { Button, cx } from '../ui';

// Sticky in the thumb zone, above the phone tab bar (3.5rem + safe area), so Save is always one
// tap away however long the page gets. Put it last in the section it saves.
const SaveBar = ({ dirtyCount, invalid = false, saving, onSave, onDiscard, saveLabel = fr.save }) => (
  <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 md:bottom-4">
    <div className={cx(
      'flex flex-wrap items-center gap-3 rounded-card border bg-surface/95 px-4 py-3 shadow-pop backdrop-blur-md sm:px-5',
      dirtyCount ? 'border-warn/50' : 'border-line'
    )}>
      <p role="status" className={cx('flex min-w-0 flex-1 items-center gap-2 text-sm', dirtyCount ? 'text-warn' : 'text-faint')}>
        {invalid
          ? <><TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-bad" strokeWidth={1.75} /><span className="text-bad">{fr.eventEditorInvalid}</span></>
          : dirtyCount
            ? fr.eventEditorUnsaved.replace('{n}', dirtyCount)
            : <><Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />{fr.eventEditorAllSaved}</>}
      </p>
      <div className="flex gap-2">
        {dirtyCount > 0 && (
          <Button variant="ghost" onClick={onDiscard} disabled={saving}>
            <Undo2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">{fr.eventEditorDiscard}</span>
            <span className="sr-only sm:hidden">{fr.eventEditorDiscard}</span>
          </Button>
        )}
        <Button onClick={onSave} disabled={!dirtyCount || invalid} loading={saving}>
          <Save aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
          {saving ? fr.savingInProgress : saveLabel}
        </Button>
      </div>
    </div>
  </div>
);

export default SaveBar;
