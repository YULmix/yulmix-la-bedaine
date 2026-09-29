import { ArrowLeft, BedDouble, Check, FileText, Plus, Save, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatEventDates } from '../../lib/eventDisplay';
import { NUMBER_FIELDS } from '../../lib/eventDraft';
import { Button, Card, Field, Input, Notice, Tag, Textarea, Toggle, cx } from '../ui';
import { EVENT_STATUS } from './AdminEvents';
import { EventSleepingPlan } from './EventLocations';

const SECTIONS = [
  { id: 'details', labelKey: 'eventSectionDetails', icon: FileText },
  { id: 'sleeping', labelKey: 'eventFieldsetSleeping', icon: BedDouble }
];

const CARDS = [
  { id: 'event-essentials', labelKey: 'eventFieldsetEssentials' },
  { id: 'event-calendar', labelKey: 'eventFieldsetCalendar' },
  { id: 'event-members', labelKey: 'eventFieldsetMembers' }
];

const EditorCard = ({ id, title, children }) => (
  <Card aria-labelledby={`${id}-title`} id={id} className="scroll-mt-20 space-y-4 p-5 sm:p-6">
    <h3 id={`${id}-title`} className="text-lg font-semibold text-ink">{title}</h3>
    {children}
  </Card>
);

const ERROR_MESSAGES = {
  integer: () => fr.eventFieldInteger,
  min: field => fr.eventFieldMin.replace('{min}', NUMBER_FIELDS[field].min),
  required: () => fr.eventFieldRequired,
  order: () => fr.eventRegStartOrder,
  incomplete: () => fr.eventLinkIncomplete,
  url: () => fr.eventLinkUrl
};

const fieldError = (field, errors) => (errors[field] ? ERROR_MESSAGES[errors[field]](field) : undefined);

const LinksEditor = ({ links, errors = {}, onChange }) => {
  const update = (index, key, text) => onChange(links.map((row, i) => (i === index ? { ...row, [key]: text } : row)));
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-muted">{fr.eventExternalLinksLabel}</p>
      <ul className="space-y-2">
        {links.map((row, index) => {
          const error = errors[index] && ERROR_MESSAGES[errors[index]]();
          const errorId = `event-link-${index}-error`;
          return (
          <li key={index} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Input aria-label={fr.eventExternalLinksLabelPlaceholder} placeholder={fr.eventExternalLinksLabelPlaceholder}
              invalid={errors[index] === 'incomplete' && !row.label?.trim()} aria-describedby={error ? errorId : undefined}
              value={row.label ?? ''} onChange={e => update(index, 'label', e.target.value)} />
            <Button variant="ghost" size="icon" onClick={() => onChange(links.filter((_, i) => i !== index))}
              aria-label={fr.eventExternalLinksRemoveRow} className="sm:order-last">
              <Trash2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
            </Button>
            <Input type="url" aria-label={fr.eventExternalLinksUrlPlaceholder} placeholder={fr.eventExternalLinksUrlPlaceholder}
              invalid={errors[index] === 'url' || (errors[index] === 'incomplete' && !row.url?.trim())} aria-describedby={error ? errorId : undefined}
              value={row.url ?? ''} onChange={e => update(index, 'url', e.target.value)} className="col-span-2 sm:col-span-1" />
            {error && <p id={errorId} className="col-span-full text-sm text-bad sm:order-last">{error}</p>}
          </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" onClick={() => onChange([...links, { label: '', url: '' }])} className="mt-2">
        <Plus aria-hidden="true" className="size-4" />{fr.eventExternalLinksAddRow}
      </Button>
    </div>
  );
};

// Sticky in the thumb zone, above the phone tab bar (3.5rem + safe area), so Save is always one
// tap away however long the form gets.
const SaveBar = ({ dirtyCount, invalid, saving, onSave, onDiscard }) => (
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
          {saving ? fr.savingInProgress : fr.save}
        </Button>
      </div>
    </div>
  </div>
);

const DetailsForm = ({ value, onChange, errors }) => {
  const text = field => ({ value: value(field) ?? '', onChange: e => onChange(field, e.target.value) });
  const number = field => ({ type: 'number', inputMode: 'numeric', min: NUMBER_FIELDS[field].min, ...text(field) });
  const numberField = (field, labelKey) => (
    <Field label={fr[labelKey]} error={fieldError(field, errors)}>
      {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} {...number(field)} />}
    </Field>
  );

  return (
    <>
      <EditorCard id="event-essentials" title={fr.eventFieldsetEssentials}>
        <Field label={fr.eventTitle} error={fieldError('theme', errors)}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} {...text('theme')} />}
        </Field>
        <Field label={fr.eventDescriptionLabel}>{({ id }) => <Textarea id={id} rows={4} {...text('description')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label={fr.eventVenueAddressLabel}>{({ id }) => <Input id={id} {...text('venue_address')} />}</Field>
          {numberField('duration_days', 'eventDurationLabel')}
        </div>
      </EditorCard>

      <EditorCard id="event-calendar" title={fr.eventFieldsetCalendar}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={fr.eventStartDateLabel}>{({ id }) => <Input id={id} type="date" {...text('event_start_date')} />}</Field>
          <Field label={fr.eventRegStartDateLabel} error={fieldError('reg_start_date', errors)}>
            {({ id, describedBy, invalid }) => <Input id={id} type="date" aria-describedby={describedBy} invalid={invalid} {...text('reg_start_date')} />}
          </Field>
          {numberField('z_intent_months', 'eventIntentMonthsLabel')}
          {numberField('x_reg_close_weeks', 'eventRegCloseWeeksLabel')}
          {numberField('max_attendees', 'eventMaxAttendeesLabel')}
        </div>
        <Toggle label={fr.eventRegOpenLabel} checked={!!value('is_reg_open')} onChange={checked => onChange('is_reg_open', checked)} />
      </EditorCard>

      <EditorCard id="event-members" title={fr.eventFieldsetMembers}>
        <Field label={fr.eventPointsOfContactLabel}>{({ id }) => <Textarea id={id} {...text('points_of_contact')} />}</Field>
        <Field label={fr.eventInstructionsLabel}>{({ id }) => <Textarea id={id} rows={5} {...text('instructions')} />}</Field>
        <LinksEditor links={value('external_links') || []} errors={errors.external_links} onChange={links => onChange('external_links', links)} />
      </EditorCard>
    </>
  );
};

// The event editor: a page in the Événements tab (?event=<id>&section=…), not a dialog, so it has
// room for the sleeping plan and survives reloads, Back and admin-tab switches. The descriptive
// fields are a draft held by AdminView (and sessionStorage) until Save; the sleeping plan saves as
// it's edited, on its own section so the two save models never share a screen.
const EventEditor = ({
  event,
  section,
  onSectionChange,
  locationId,
  onLocationChange,
  changes,
  dirtyCount,
  errors,
  restored,
  saving,
  onChange,
  onSave,
  onDiscard,
  onBack
}) => {
  const value = field => (field in changes ? changes[field] : event[field]);
  const status = EVENT_STATUS[event.status] || EVENT_STATUS.DRAFT;
  const dates = formatEventDates(event);
  const invalid = Object.keys(errors).length > 0;

  const handleSectionKeyDown = (keyEvent) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(keyEvent.key)) return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    const next = SECTIONS[(SECTIONS.findIndex(s => s.id === section) + 1) % SECTIONS.length].id;
    onSectionChange(next);
    requestAnimationFrame(() => document.getElementById(`event-section-${next}`)?.focus());
  };

  return (
    <section className="space-y-6" aria-labelledby="event-editor-title">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3">
          <ArrowLeft aria-hidden="true" className="size-4" />{fr.eventEditorBack}
        </Button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="event-editor-title" className="min-w-0 text-display-md font-display text-ink [overflow-wrap:anywhere]">
            {value('theme') || fr.eventTitle}
          </h2>
          <Tag tone={status.tone}>{fr[status.key]}</Tag>
          {dirtyCount > 0 && <Tag tone="warn">{fr.unsavedTag}</Tag>}
        </div>
        {dates && <p className="font-data text-xs text-faint">{dates}</p>}
      </div>

      <div role="tablist" aria-label={fr.eventEditorSectionsLabel} onKeyDown={handleSectionKeyDown}
        className="inline-flex gap-1 rounded-full border border-line bg-surface p-1">
        {SECTIONS.map(({ id, labelKey, icon: Icon }) => {
          const selected = id === section;
          return (
            <button key={id} type="button" role="tab" id={`event-section-${id}`} aria-selected={selected}
              aria-controls={`event-section-panel-${id}`} tabIndex={selected ? 0 : -1} onClick={() => onSectionChange(id)}
              className={cx(
                'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition duration-150',
                selected ? 'tint-neon text-ink' : 'text-faint hover:text-ink'
              )}>
              <Icon aria-hidden="true" className={cx('size-4.5', selected && 'text-neon')} strokeWidth={1.75} />
              {fr[labelKey]}
              {id === 'details' && dirtyCount > 0 && <span className="size-2 rounded-full bg-warn" aria-label={fr.unsavedTag} />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`event-section-panel-${section}`} aria-labelledby={`event-section-${section}`} key={section} className="animate-step">
        {section === 'sleeping' ? (
          <EventSleepingPlan eventId={event.id} locationId={locationId} onLocationChange={onLocationChange} />
        ) : (
          <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
            <nav aria-label={fr.eventEditorJumpLabel} className="hidden lg:block">
              <ul className="sticky top-20 space-y-1">
                {CARDS.map(card => (
                  <li key={card.id}>
                    <button type="button" onClick={() => document.getElementById(card.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="flex min-h-11 w-full items-center rounded-control px-3 text-left text-sm text-muted transition duration-150 hover:bg-raised hover:text-ink">
                      {fr[card.labelKey]}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="max-w-3xl space-y-6">
              {restored && <Notice tone="info">{fr.eventEditorRestored}</Notice>}
              <DetailsForm value={value} onChange={onChange} errors={errors} />
              <SaveBar dirtyCount={dirtyCount} invalid={invalid} saving={saving} onSave={onSave} onDiscard={onDiscard} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default EventEditor;
