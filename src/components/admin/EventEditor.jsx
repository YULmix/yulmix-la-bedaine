import { BedDouble, FileText, Plus, Trash2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatEventDates } from '../../lib/eventDisplay';
import { NUMBER_FIELDS, dateInputValue } from '../../lib/eventDraft';
import { Button, Card, Field, Input, Notice, Tag, Textarea, Toggle, ViewPanel, ViewTabs } from '../ui';
import { EVENT_STATUS } from './AdminEvents';
import { EventVenuePlan } from './EventVenue';
import DrillDownHeader from './DrillDownHeader';
import SaveBar from './SaveBar';

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

const DetailsForm = ({ value, onChange, errors, creating }) => {
  const text = field => ({ value: value(field) ?? '', onChange: e => onChange(field, e.target.value) });
  // Shown and typed in the event time zone (#149); a draft already holds the input's text.
  const dateTime = field => ({ value: dateInputValue(value(field)), onChange: e => onChange(field, e.target.value) });
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
        {/* The address is the venue's (#145), edited in the Couchage section. */}
        <div className="sm:max-w-40">{numberField('duration_days', 'eventDurationLabel')}</div>
      </EditorCard>

      <EditorCard id="event-calendar" title={fr.eventFieldsetCalendar}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={fr.eventStartDateLabel} hint={fr.eventTimeZoneHint} error={errors.event_start_date && fr.eventStartDateRequired}>
            {({ id, describedBy, invalid }) => <Input id={id} type="datetime-local" aria-describedby={describedBy} invalid={invalid} {...dateTime('event_start_date')} />}
          </Field>
          <Field label={fr.eventRegStartDateLabel} hint={fr.eventTimeZoneHint} error={fieldError('reg_start_date', errors)}>
            {({ id, describedBy, invalid }) => <Input id={id} type="datetime-local" aria-describedby={describedBy} invalid={invalid} {...dateTime('reg_start_date')} />}
          </Field>
          {numberField('z_intent_months', 'eventIntentMonthsLabel')}
          {numberField('x_reg_close_weeks', 'eventRegCloseWeeksLabel')}
          {numberField('max_attendees', 'eventMaxAttendeesLabel')}
        </div>
        {/* A new event is created with registrations closed; opening them is for once it exists. */}
        {!creating && <Toggle label={fr.eventRegOpenLabel} checked={!!value('is_reg_open')} onChange={checked => onChange('is_reg_open', checked)} />}
      </EditorCard>

      <EditorCard id="event-members" title={fr.eventFieldsetMembers}>
        <Field label={fr.eventPointsOfContactLabel}>{({ id }) => <Textarea id={id} {...text('points_of_contact')} />}</Field>
        <Field label={fr.eventInstructionsLabel}>{({ id }) => <Textarea id={id} rows={5} {...text('instructions')} />}</Field>
        <LinksEditor links={value('external_links') || []} errors={errors.external_links} onChange={links => onChange('external_links', links)} />
      </EditorCard>
    </>
  );
};

// The event editor: a page in the Événements tab (/admin/events/<id>), not a dialog, so it has
// room for the sleeping plan and survives reloads, Back and admin-tab switches. The descriptive
// fields are a draft held by AdminView (and sessionStorage) until Save; the sleeping plan saves as
// it's edited, on its own section so the two save models never share a screen.
// With no `event` it is the form for a new one (#111, /admin/events/new): the same details form,
// but no status, no Couchage (it needs an event) and « Créer » instead of « Enregistrer ».
const EventEditor = ({
  event,
  section,
  onSectionChange,
  onVenueChange,
  changes,
  dirtyCount,
  errors,
  restored,
  saving,
  onChange,
  onSave,
  onDiscard,
  backTo
}) => {
  const creating = !event;
  const value = field => (field in changes ? changes[field] : event?.[field]);
  const status = EVENT_STATUS[event?.status] || EVENT_STATUS.DRAFT;
  const dates = event && formatEventDates(event);
  const invalid = Object.keys(errors).length > 0;

  const details = (
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
        <DetailsForm value={value} onChange={onChange} errors={errors} creating={creating} />
        <SaveBar dirtyCount={dirtyCount} invalid={invalid} saving={saving} onSave={onSave} onDiscard={onDiscard}
          creating={creating} hint={fr.eventNewHint} saveLabel={creating ? fr.eventCreate : undefined} />
      </div>
    </div>
  );

  return (
    <section className="space-y-5 md:space-y-6" aria-labelledby="event-editor-title">
      <DrillDownHeader
        backTo={backTo}
        backLabel={fr.adminTabEvents}
        titleId="event-editor-title"
        title={creating ? fr.eventNew : value('theme') || fr.eventTitle}
        tags={(
          <>
            {!creating && <Tag tone={status.tone}>{fr[status.key]}</Tag>}
            {dirtyCount > 0 && <Tag tone="warn">{fr.unsavedTag}</Tag>}
          </>
        )}
        meta={dates && <p className="font-data text-xs text-faint">{dates}</p>}
      />

      {!creating && <ViewTabs
        views={SECTIONS.map(({ id, labelKey, icon }) => ({
          id,
          label: fr[labelKey],
          icon,
          badge: id === 'details' && dirtyCount > 0 && <span className="size-2 rounded-full bg-warn" aria-label={fr.unsavedTag} />
        }))}
        value={section}
        onChange={onSectionChange}
        label={fr.eventEditorSectionsLabel}
        idPrefix="event-section"
      />}

      {creating ? details : (
        <ViewPanel idPrefix="event-section" value={section}>
          {section === 'sleeping' ? <EventVenuePlan event={event} onVenueChange={onVenueChange} /> : details}
        </ViewPanel>
      )}
    </section>
  );
};

export default EventEditor;
