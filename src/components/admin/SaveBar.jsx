import { Check, Save, TriangleAlert, Undo2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { Button, cx } from '../ui';

// Sticky in the thumb zone, above the phone tab bar (3.5rem + safe area), so Save is always one
// tap away however long the page gets. Put it last in the section it saves. The buttons keep
// their size and stay on the status line; the status wraps beside them rather than under them.
const SaveBar = ({ dirtyCount, invalid = false, saving, onSave, onDiscard }) => (
  <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 md:bottom-4">
    <div className={cx(
      'flex items-center gap-2 rounded-card border bg-surface/95 py-2 pr-2 pl-4 shadow-pop backdrop-blur-md sm:gap-3 sm:py-3 sm:pr-3 sm:pl-5',
      dirtyCount ? 'border-warn/50' : 'border-line'
    )}>
      <p role="status" className={cx('flex min-w-0 flex-1 items-center gap-2 text-sm leading-snug', dirtyCount ? 'text-warn' : 'text-faint')}>
        {invalid
          ? <><TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-bad" strokeWidth={1.75} /><span className="text-bad">{fr.eventEditorInvalid}</span></>
          : dirtyCount
            ? <>
              <span className="whitespace-nowrap sm:hidden">{fr.saveBarPendingShort.replace('{n}', dirtyCount)}</span>
              <span className="hidden sm:inline">{fr.eventEditorUnsaved.replace('{n}', dirtyCount)}</span>
            </>
            : <><Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />{fr.eventEditorAllSaved}</>}
      </p>
      <div className="flex shrink-0 gap-1 sm:gap-2">
        {dirtyCount > 0 && (
          <Button variant="ghost" onClick={onDiscard} disabled={saving} aria-label={fr.eventEditorDiscard} title={fr.eventEditorDiscard} className="px-3 sm:px-4">
            <Undo2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
            <span aria-hidden="true" className="hidden lg:inline">{fr.eventEditorDiscardShort}</span>
          </Button>
        )}
        {/* Short on purpose; the spinner says it's saving. */}
        <Button onClick={onSave} disabled={!dirtyCount || invalid} loading={saving} className="px-4">
          {!saving && <Save aria-hidden="true" className="hidden size-4.5 sm:block" strokeWidth={1.75} />}
          {fr.save}
        </Button>
      </div>
    </div>
  </div>
);

export default SaveBar;
