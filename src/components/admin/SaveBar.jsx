import { Check, Save, TriangleAlert, Undo2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { Button, cx } from '../ui';

// Sticky in the thumb zone, above the phone's bottom bar (3.5rem + safe area), so Save is always
// one tap away however long the page gets. Put it last in the section it saves. A floating
// toolbar, not a pane: the raised colour and a deep shadow set it apart from the cards it passes
// over, and from sm up it only takes the room it needs, on the right. The outer strip lets clicks
// through to the page beside it. The buttons keep their size and stay on the status line.
// `creating` is for a record that doesn't exist yet (#111): nothing is "saved" before it is, so it
// shows `hint` instead of the saved state, says `saveLabel`, and can always be submitted (the
// form says what is missing).
const SaveBar = ({ dirtyCount, invalid = false, saving, onSave, onDiscard, creating = false, hint, saveLabel }) => (
  <div className="pointer-events-none sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex justify-end md:bottom-6">
    <div className={cx(
      'pointer-events-auto flex w-full items-center gap-2 rounded-card border bg-raised py-2 pr-2 pl-4 shadow-pop sm:w-auto sm:max-w-full sm:gap-4 sm:pl-5',
      dirtyCount ? 'border-warn/60' : 'border-edge/60'
    )}>
      <p role="status" className={cx('flex min-w-0 flex-1 items-center gap-2 text-sm leading-snug', dirtyCount ? 'text-warn' : 'text-faint')}>
        {invalid
          ? <><TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-bad" strokeWidth={1.75} /><span className="text-bad">{fr.eventEditorInvalid}</span></>
          : dirtyCount
            ? <>
              <span className="whitespace-nowrap sm:hidden">{fr.saveBarPendingShort.replace('{n}', dirtyCount)}</span>
              <span className="hidden sm:inline">{fr.eventEditorUnsaved.replace('{n}', dirtyCount)}</span>
            </>
            : creating
              ? <span>{hint}</span>
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
        <Button onClick={onSave} disabled={(!dirtyCount && !creating) || invalid} loading={saving} className="px-4">
          {!saving && <Save aria-hidden="true" className="hidden size-4.5 sm:block" strokeWidth={1.75} />}
          {saveLabel ?? fr.save}
        </Button>
      </div>
    </div>
  </div>
);

export default SaveBar;
